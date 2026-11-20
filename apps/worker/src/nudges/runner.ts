import {
	instrumentHtml,
	type NudgeHistoryItem,
	newId,
	renderTemplate,
	replySubject,
	trackingUrls,
} from "@bet/shared";
import type { MailboxConnector, SentReply } from "../connectors/types";
import { DAY } from "../env";
import { countEvents } from "../services/summary";
import type { Store, StoredMessage } from "../store/types";
import {
	BATCH_LIMIT,
	backoffMs,
	LEASE_MS,
	MAX_ATTEMPTS,
	nextAllowed,
} from "./schedule";
import type {
	NudgeStore,
	PendingSend,
	SequencePatch,
	StoredSequence,
} from "./store/types";

export interface RunnerDeps {
	store: Store;
	nudges: NudgeStore;
	now: number;
	/** Live connector for a kind, or null when not connected. */
	connector(kind: string): Promise<MailboxConnector | null>;
}

export type Outcome =
	| "sent"
	| "replied"
	| "opened"
	| "bounced"
	| "done"
	| "deferred"
	| "cancelled"
	| "error"
	| "lost_lock";

const UNSUBSCRIBE = /unsubscribe|opt-?out/i;

/** Links the owner clearly doesn't want rewritten. Mirrors the extension's rule. */
const shouldTrackLink = (url: string) => !UNSUBSCRIBE.test(url);

/**
 * One scheduler pass: claim due sequences with a lease, then for each one check the
 * thread for a reply and either stop or send the next nudge. Every sequence is
 * isolated (its own try/catch with backoff).
 */
export async function runDueNudges(
	deps: RunnerDeps,
	limit = BATCH_LIMIT,
): Promise<Record<Outcome, number>> {
	const token = newId();
	const claimed = await deps.nudges.claimDue(deps.now, LEASE_MS, limit, token);
	const tally = {} as Record<Outcome, number>;
	for (const seq of claimed) {
		const outcome = await processSequence(deps, seq, token);
		tally[outcome] = (tally[outcome] ?? 0) + 1;
	}
	return tally;
}

export async function processSequence(
	deps: RunnerDeps,
	seq: StoredSequence,
	token: string,
): Promise<Outcome> {
	const { nudges, now } = deps;
	/** Writes the patch and releases the lock, only while we still hold it and it's active. */
	const release = (patch: Omit<SequencePatch, "updatedAt">) =>
		nudges.updateSequence(
			seq.id,
			{ ...patch, lockUntil: null, lockToken: null, updatedAt: now },
			{ lockToken: token, states: ["active"] },
		);
	const log = (item: Omit<NudgeHistoryItem, "at">) =>
		nudges.addHistory(seq.id, { at: now, ...item });

	try {
		const msg = await deps.store.getMessage(seq.messageId);
		if (!msg) {
			await release({
				state: "cancelled",
				nextAt: null,
				lastError: "The original email was deleted",
			});
			await log({ kind: "cancelled", detail: "original email deleted" });
			return "cancelled";
		}
		const connector = await deps.connector(seq.connector);
		if (!connector) throw new Error("Mailbox is not connected");

		const since = msg.sentAt ?? seq.createdAt;
		const thread = { threadId: seq.providerThreadId };
		const insp = await connector.findReplies(
			thread,
			since,
			connector.ownerAddress,
		);

		if (insp.reply) {
			await release({ state: "replied", nextAt: null, pendingSend: null });
			await log({ kind: "reply", detail: insp.reply.from });
			await deps.store.insertEvent({
				messageId: msg.id,
				type: "reply",
				at: Math.min(insp.reply.at, now),
				source: "direct",
			});
			return "replied";
		}
		if (insp.bounced) {
			await release({
				state: "failed",
				nextAt: null,
				pendingSend: null,
				lastError: "The email bounced",
			});
			await log({ kind: "bounced" });
			return "bounced";
		}

		// A previous run stored this marker and may or may not have sent: the thread knows.
		const pending = seq.pendingSend;
		if (pending && insp.sentMarkers.includes(pending.nudgeMessageId)) {
			return completeSend(deps, seq, msg, pending, null, release);
		}

		const step = seq.steps[seq.nextStep];
		if (!step) {
			// Every nudge went out and the final reply check found nothing.
			await release({ state: "done", nextAt: null, pendingSend: null });
			return "done";
		}

		if (seq.stopOnOpen && (await wasOpened(deps, seq, msg))) {
			await release({ state: "opened", nextAt: null, pendingSend: null });
			await log({ kind: "opened" });
			return "opened";
		}

		const allowedAt = nextAllowed(now, seq.sendWindow);
		if (allowedAt > now) {
			await release({ nextAt: allowedAt });
			return "deferred";
		}

		// Reuse the pending id on retry: same tracked message, and the marker stays valid.
		const nudgeId = pending?.nudgeMessageId ?? newId();
		const to = seq.to.length ? seq.to : msg.recipients;
		const subject = replySubject(msg.subject);
		const body = renderTemplate(step.html, to);
		const { html, links } = instrumentHtml(body, {
			messageId: nudgeId,
			urls: trackingUrls(seq.trackerBase),
			trackOpens: msg.trackOpens,
			trackLinks: msg.trackLinks,
			shouldTrackLink,
		});
		await deps.store.upsertMessage({
			id: nudgeId,
			provider: msg.provider,
			subject,
			recipients: [...to, ...seq.cc],
			mode: "shared",
			groupId: msg.groupId ?? msg.id,
			trackOpens: msg.trackOpens,
			trackLinks: msg.trackLinks,
			links,
			createdAt: now,
		});
		const marker: PendingSend = {
			step: seq.nextStep,
			nudgeMessageId: nudgeId,
			at: now,
		};
		const marked = await nudges.updateSequence(
			seq.id,
			{ pendingSend: marker, updatedAt: now },
			{ lockToken: token, states: ["active"] },
		);
		if (!marked) return "lost_lock"; // paused/cancelled meanwhile, or lease taken over

		const sent = await connector.sendReply(thread, {
			from: connector.ownerAddress,
			to,
			cc: seq.cc,
			subject,
			html,
			...(insp.threading.inReplyTo
				? { inReplyTo: insp.threading.inReplyTo }
				: {}),
			references: insp.threading.references,
			markerId: nudgeId,
		});
		return completeSend(deps, seq, msg, marker, sent, release);
	} catch (err) {
		const attempts = seq.attempts + 1;
		const message = err instanceof Error ? err.message : String(err);
		const failed = attempts >= MAX_ATTEMPTS;
		console.warn(`nudge ${seq.id} attempt ${attempts} failed`, message);
		try {
			await release({
				attempts,
				lastError: message.slice(0, 500),
				nextAt: failed ? null : now + backoffMs(attempts),
				...(failed ? { state: "failed" as const } : {}),
			});
			await log({ kind: "error", detail: message.slice(0, 200) });
		} catch (inner) {
			console.error(`nudge ${seq.id} could not record failure`, inner);
		}
		return "error";
	}
}

async function completeSend(
	deps: RunnerDeps,
	seq: StoredSequence,
	msg: StoredMessage,
	pending: PendingSend,
	sent: SentReply | null,
	release: (patch: Omit<SequencePatch, "updatedAt">) => Promise<boolean>,
): Promise<Outcome> {
	const { now } = deps;
	const first = await deps.nudges.addHistory(seq.id, {
		at: now,
		kind: "sent",
		step: pending.step,
		nudgeMessageId: pending.nudgeMessageId,
	});
	await deps.store.markSent(pending.nudgeMessageId, {
		sentAt: sent ? now : pending.at,
		providerThreadId: sent?.providerThreadId ?? seq.providerThreadId,
		...(sent ? { providerMessageId: sent.providerMessageId } : {}),
	});
	if (first) {
		await deps.store.insertEvent({
			messageId: msg.id,
			type: "nudge_sent",
			at: now,
			source: "direct",
		});
	}
	const nextStep = pending.step + 1;
	// After the last nudge, check once more for a reply after the same interval.
	const wait =
		seq.steps[nextStep]?.afterDays ?? seq.steps[pending.step]?.afterDays ?? 3;
	const nextAt =
		nextStep < seq.steps.length
			? nextAllowed(now + wait * DAY, seq.sendWindow)
			: now + Math.max(1, wait) * DAY;
	await release({
		nextStep,
		nextAt,
		pendingSend: null,
		attempts: 0,
		lastError: null,
	});
	return "sent";
}

/** Counted human opens or clicks on the original or any of its nudges. */
async function wasOpened(
	deps: RunnerDeps,
	seq: StoredSequence,
	msg: StoredMessage,
): Promise<boolean> {
	const history = (await deps.nudges.getHistory([seq.id])).get(seq.id) ?? [];
	const ids = [
		msg.id,
		...history.flatMap((h) => (h.nudgeMessageId ? [h.nudgeMessageId] : [])),
	];
	const c = countEvents(await deps.store.getEventsForMessages(ids));
	return c.opens > 0 || c.clicks > 0;
}
