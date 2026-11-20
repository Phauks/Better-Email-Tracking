import type { ConnectorKind, Recipient } from "@bet/shared";

/**
 * Server-side access to the owner's mailbox, used by follow-up nudges so they work
 * while the owner's computer is off. Gmail is the first implementation; Outlook
 * (Microsoft Graph) or Yahoo (IMAP/SMTP via a relay) would implement the same shape.
 */

/** A conversation in the owner's mailbox, by the provider's own id. */
export interface ThreadRef {
	threadId: string;
}

export interface ReplyInfo {
	at: number;
	from: string;
}

export interface ThreadInspection {
	/** First message after `since` from someone other than the owner, if any. */
	reply: ReplyInfo | null;
	/** A delivery failure notice arrived after `since`. */
	bounced: boolean;
	/** Nudge marker ids (X-BET-Nudge-Id) already in the thread: used to avoid double sends. */
	sentMarkers: string[];
	/** Threading headers of the newest message, for In-Reply-To / References. */
	threading: { inReplyTo?: string; references: string[] };
}

export interface OutgoingReply {
	from: string;
	to: Recipient[];
	cc?: Recipient[];
	subject: string;
	html: string;
	inReplyTo?: string;
	references: string[];
	/** Unique id written to a header so a retry can tell whether this nudge went out. */
	markerId: string;
}

export interface SentReply {
	providerMessageId: string;
	providerThreadId: string;
}

export interface MailboxConnector {
	readonly kind: ConnectorKind;
	/** The mailbox address, as reported by the provider at connect time. */
	readonly ownerAddress: string;
	findReplies(
		thread: ThreadRef,
		since: number,
		ownerAddress: string,
	): Promise<ThreadInspection>;
	sendReply(thread: ThreadRef, reply: OutgoingReply): Promise<SentReply>;
}

/** Stored connection (refresh token sealed with TOKEN_ENC_KEY). */
export interface ConnectorRecord {
	kind: ConnectorKind;
	email: string;
	refreshTokenEnc: string;
	scopes: string;
	connectedAt: number;
}

export const NUDGE_MARKER_HEADER = "X-BET-Nudge-Id";
