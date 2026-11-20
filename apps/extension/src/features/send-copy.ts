import type { Recipient, TrackingMode } from "@bet/shared";
import type { ComposeSession, SentInfo } from "../providers/types";
import { emitTrackedSent } from "./sent-events";
import type { FeatureContext } from "./types";

/**
 * The per-copy send pipeline shared by "Track each recipient" and mail merge:
 * open a compose for one recipient, send it, wait for the client to confirm,
 * then mark the tracked message sent and announce it through onTrackedSent.
 */

const SENT_TIMEOUT_MS = 60_000;
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CopyResult extends SentInfo {
	/** False when the client never confirmed the send within the timeout. */
	confirmed: boolean;
}

/** Sends a compose and resolves with its ids once the client reports it sent. */
export function sendAndWait(
	session: ComposeSession,
	timeoutMs = SENT_TIMEOUT_MS,
): Promise<CopyResult> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve({ confirmed: false }), timeoutMs);
		session.onSent((info) => {
			clearTimeout(timer);
			resolve({ ...info, confirmed: true });
		});
		session.send();
	});
}

export interface TrackedCopy {
	/** Tracked message id to mark sent. */
	id: string;
	recipient: Recipient;
	mode: TrackingMode;
	groupId?: string;
	/** The compose the user sent, if any (mail merge copies have none). */
	origin?: ComposeSession;
	/**
	 * Only mark sent when the client confirmed the send. Individual sends mark
	 * unconfirmed copies too (the user watched them go); mail merge reports them as failed.
	 */
	requireConfirmation?: boolean;
}

export interface CopyRequest {
	to: string;
	subject: string;
	/** Already instrumented body. */
	html: string;
	/** Omit for an untracked copy. */
	tracked?: TrackedCopy;
}

/** Opens one copy addressed to a single recipient, sends it, and marks it sent. */
export async function sendCopy(
	ctx: FeatureContext,
	copy: CopyRequest,
): Promise<CopyResult> {
	const session = await ctx.adapter.openCompose({
		to: [copy.to],
		subject: copy.subject,
		html: copy.html,
	});
	await settle(300); // let the client settle recipients/body before sending
	const result = await sendAndWait(session);
	const t = copy.tracked;
	if (!t || (t.requireConfirmation && !result.confirmed)) return result;

	const { confirmed: _confirmed, ...info } = result;
	const sentAt = Date.now();
	await ctx.api.markSent(t.id, { sentAt, ...info }).catch((err) => {
		console.warn("[bet] markSent failed", err);
	});
	emitTrackedSent({
		session: t.origin,
		messageId: t.id,
		mode: t.mode,
		groupId: t.groupId,
		sentAt,
		to: [t.recipient],
		cc: [],
		...info,
	});
	return result;
}
