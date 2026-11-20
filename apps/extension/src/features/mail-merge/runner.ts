import {
	type CampaignDetail,
	type CampaignLeaseRequest,
	type CampaignRecipient,
	type RecipientResultRequest,
	type RenderedMessage,
	renderMessage,
	type UpdateCampaignRequest,
} from "@bet/shared";
import type { ResultOutcome } from "../../api/client";
import {
	INTERRUPTED_ERROR,
	leaseTtlMs,
	MAX_CONSECUTIVE_FAILURES,
	nextDelayMs,
	nextSendAt,
	nextStep,
} from "./queue";

/** The Worker calls the runner needs (proxied through the background in production). */
export interface RunnerApi {
	get(id: string): Promise<CampaignDetail>;
	lease(id: string, req: CampaignLeaseRequest): Promise<boolean>;
	result(
		id: string,
		email: string,
		req: RecipientResultRequest,
	): Promise<ResultOutcome>;
	update(id: string, req: UpdateCampaignRequest): Promise<CampaignDetail>;
}

export interface SendArgs {
	campaign: CampaignDetail;
	recipient: CampaignRecipient;
	/** Tracked message id (also the claim recorded on the Worker). */
	messageId: string;
	rendered: RenderedMessage;
}

export type RunEvent =
	| { kind: "sent"; email: string; sentThisRun: number; remaining: number }
	| { kind: "failed"; email: string; error: string }
	| { kind: "waiting"; until: number };

export interface RunnerDeps {
	api: RunnerApi;
	/** Sends one copy; resolves confirmed=false when the client never confirmed. */
	send(args: SendArgs): Promise<{ confirmed: boolean }>;
	runnerId: string;
	makeId(): string;
	now(): number;
	sleep(ms: number): Promise<void>;
	random?: () => number;
	onEvent?(event: RunEvent): void;
	/** Longest single wait, so a pause or cancel from the dashboard is noticed quickly. */
	pollMs?: number;
}

export type RunOutcome =
	| "done"
	| "cap"
	/** Paused, cancelled or otherwise not sending any more. */
	| "stopped"
	/** Another tab holds the send lease. */
	| "busy"
	/** Paused after repeated failures. */
	| "failing";

export const UNCONFIRMED_ERROR =
	"The mail client did not confirm the send. Check your Sent folder before retrying.";

/** Template values for a recipient: email and name are always available. */
export function recipientFields(r: CampaignRecipient): Record<string, string> {
	return { email: r.email, ...(r.name ? { name: r.name } : {}), ...r.fields };
}

const errorText = (err: unknown) =>
	err instanceof Error ? err.message : String(err);

/**
 * Sends a campaign's queued recipients one at a time: lease -> pick -> wait for the
 * throttle -> render -> claim -> send -> report. All queue state lives in the Worker,
 * so a reloaded tab resumes where the last one stopped.
 */
export async function runCampaign(
	id: string,
	deps: RunnerDeps,
): Promise<{ outcome: RunOutcome; sent: number }> {
	const { api } = deps;
	const pollMs = deps.pollMs ?? 15_000;
	let sent = 0;
	let failures = 0;
	let plannedDelay: number | undefined;

	for (;;) {
		const campaign = await api.get(id);
		if (campaign.status === "done") return { outcome: "done", sent };
		if (campaign.status !== "sending") return { outcome: "stopped", sent };
		const leased = await api.lease(id, {
			runnerId: deps.runnerId,
			ttlMs: leaseTtlMs(campaign.settings),
		});
		if (!leased) return { outcome: "busy", sent };

		const step = nextStep(campaign, sent);
		switch (step.kind) {
			case "stop":
				return { outcome: "stopped", sent };
			case "done":
				return { outcome: "done", sent };
			case "cap":
				await api.update(id, { action: "pause", reason: step.reason });
				return { outcome: "cap", sent };
			case "interrupted":
				await api.result(id, step.recipient.email, {
					state: "failed",
					error: INTERRUPTED_ERROR,
				});
				continue;
			case "send":
				break;
		}

		const recipient = step.recipient;
		plannedDelay ??= nextDelayMs(campaign.settings, deps.random);
		const at = nextSendAt(campaign.lastSentAt, plannedDelay, deps.now());
		if (at > deps.now()) {
			deps.onEvent?.({ kind: "waiting", until: at });
			await deps.sleep(Math.min(at - deps.now(), pollMs));
			continue; // re-read: the campaign may have been paused meanwhile
		}
		plannedDelay = undefined;

		const rendered = renderMessage(
			{ subject: campaign.subjectTemplate, body: campaign.bodyTemplate },
			recipientFields(recipient),
			campaign.settings.missingPolicy,
		);
		if (rendered.blocked) {
			await api.result(id, recipient.email, {
				state: "skipped",
				error: `Missing: ${rendered.missing.join(", ")}`,
			});
			continue;
		}

		const messageId = deps.makeId();
		const claim = await api.result(id, recipient.email, {
			state: "sending",
			messageId,
		});
		if (!claim.ok) continue; // state changed under us (cancelled, other tab)

		let error = "";
		try {
			const r = await deps.send({ campaign, recipient, messageId, rendered });
			if (!r.confirmed) error = UNCONFIRMED_ERROR;
		} catch (err) {
			error = errorText(err) || "Send failed";
		}

		if (!error) {
			await api.result(id, recipient.email, {
				state: "sent",
				messageId,
				sentAt: deps.now(),
			});
			sent++;
			failures = 0;
			deps.onEvent?.({
				kind: "sent",
				email: recipient.email,
				sentThisRun: sent,
				remaining:
					campaign.recipients.filter((r) => r.state === "queued").length - 1,
			});
			continue;
		}

		await api.result(id, recipient.email, {
			state: "failed",
			messageId,
			error,
		});
		deps.onEvent?.({ kind: "failed", email: recipient.email, error });
		failures++;
		if (failures >= MAX_CONSECUTIVE_FAILURES) {
			await api.update(id, {
				action: "pause",
				reason: `${failures} sends failed in a row (last: ${error}). You may have hit a sending limit.`,
			});
			return { outcome: "failing", sent };
		}
	}
}
