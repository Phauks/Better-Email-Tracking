import type {
	EventSource,
	EventType,
	IgnoreReason,
	Provider,
	Recipient,
	TrackingMode,
} from "@bet/shared";

/** A tracked message as persisted. Times are epoch milliseconds. */
export interface StoredMessage {
	id: string;
	provider: Provider;
	subject: string;
	recipients: Recipient[];
	mode: TrackingMode;
	groupId?: string;
	trackOpens: boolean;
	trackLinks: boolean;
	createdAt: number;
	sentAt?: number;
	providerThreadId?: string;
	providerMessageId?: string;
}

export interface NewMessage
	extends Omit<
		StoredMessage,
		"sentAt" | "providerThreadId" | "providerMessageId"
	> {
	links: string[];
}

export interface SentInfo {
	sentAt: number;
	providerThreadId?: string;
	providerMessageId?: string;
}

export interface StoredEvent {
	id: number;
	messageId: string;
	type: EventType;
	linkIndex?: number;
	at: number;
	source: EventSource;
	location?: string;
	device?: string;
	/** Salted, truncated SHA-256 of the client IP. Never the raw IP. */
	ipHash?: string;
	ignored?: IgnoreReason;
}

export type NewEvent = Omit<StoredEvent, "id">;

export interface ListQuery {
	limit: number;
	/** Only messages created strictly before this time. */
	before?: number;
	groupId?: string;
	/** Case-insensitive substring match on subject or recipients. */
	q?: string;
}

export interface PurgeResult {
	messages: number;
	events: number;
	ownerViews: number;
}

/**
 * Persistence boundary. Everything above this (routes, services) is storage-agnostic;
 * D1 is the production implementation and MemoryStore backs the tests.
 */
export interface Store {
	/** Insert or update. Keeps createdAt/sentAt of an existing row; replaces links. */
	upsertMessage(msg: NewMessage): Promise<void>;
	/** Returns false when the message does not exist. */
	markSent(id: string, info: SentInfo): Promise<boolean>;
	getMessage(id: string): Promise<StoredMessage | null>;
	getLinks(id: string): Promise<string[]>;
	getLink(id: string, index: number): Promise<string | null>;
	/** Newest first by createdAt. */
	listMessages(query: ListQuery): Promise<StoredMessage[]>;
	getMessagesByIds(ids: string[]): Promise<StoredMessage[]>;
	getMessagesByThreadIds(threadIds: string[]): Promise<StoredMessage[]>;
	getMessagesByGroupIds(groupIds: string[]): Promise<StoredMessage[]>;
	/** Deletes the message with its links, events and owner views. */
	deleteMessage(id: string): Promise<boolean>;

	insertEvent(event: NewEvent): Promise<number>;
	/** All events (ignored included) for the messages, ascending by id. */
	getEventsForMessages(ids: string[]): Promise<StoredEvent[]>;
	/** Non-ignored events with id > since, ascending, at most limit. */
	getFeedEventsAfter(since: number, limit: number): Promise<StoredEvent[]>;
	/** The newest non-ignored events, ascending, at most limit. */
	getLatestFeedEvents(limit: number): Promise<StoredEvent[]>;

	recordOwnerViews(
		messageIds: string[],
		at: number,
		ipHash?: string,
	): Promise<void>;
	lastOwnerViewAt(messageId: string): Promise<number | null>;
	/**
	 * Flags counted opens of these messages at or after `since` as the owner's.
	 * Covers the race where the proxy fetch lands just before the owner-view report.
	 */
	ignoreOpensSince(
		messageIds: string[],
		since: number,
		reason: IgnoreReason,
	): Promise<number>;
	ownerIpSeenSince(ipHash: string, since: number): Promise<boolean>;

	/** Removes messages (with their data), events and owner views older than cutoff. */
	purgeBefore(cutoff: number): Promise<PurgeResult>;
}
