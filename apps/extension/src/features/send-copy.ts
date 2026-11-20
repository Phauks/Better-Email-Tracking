import type { ComposeSession, SentInfo } from "../providers/types";
import type { FeatureContext } from "./types";

/**
 * The per-copy send pipeline shared by "Track each recipient" and mail merge:
 * open a compose for one recipient, send it, wait for the client to confirm,
 * then mark the tracked message sent.
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

export interface CopyRequest {
	/** Tracked message id to mark sent; omit for an untracked copy. */
	id?: string;
	to: string;
	subject: string;
	/** Already instrumented body. */
	html: string;
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
	const { confirmed: _confirmed, ...info } = result;
	if (copy.id) {
		await ctx.api
			.markSent(copy.id, { sentAt: Date.now(), ...info })
			.catch((err) => {
				console.warn("[bet] markSent failed", err);
			});
	}
	return result;
}
