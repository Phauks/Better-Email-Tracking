import type { Recipient, TrackingMode } from "@bet/shared";
import type { ComposeSession, SentInfo } from "../providers/types";

/** A tracked message the mail client confirmed as sent. */
export interface TrackedSent extends SentInfo {
	/** The compose the user sent. For individual sends: the original, not the copy. */
	session: ComposeSession;
	messageId: string;
	mode: TrackingMode;
	groupId?: string;
	sentAt: number;
	/** Visible recipients of this message (BCC excluded). */
	to: Recipient[];
	cc: Recipient[];
}

type Listener = (sent: TrackedSent) => void;
const listeners = new Set<Listener>();

/**
 * Lets features react to tracked sends (follow-ups today; anything that needs the
 * provider thread id later) without the sending features knowing about them.
 */
export function onTrackedSent(cb: Listener): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}

export function emitTrackedSent(sent: TrackedSent): void {
	for (const cb of listeners) {
		try {
			cb(sent);
		} catch (err) {
			console.error("[bet] tracked-sent listener failed", err);
		}
	}
}
