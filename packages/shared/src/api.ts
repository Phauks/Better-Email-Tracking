import type { EventSource } from "./classify";

/**
 * HTTP contract between mail-client extensions and the Worker.
 * Provider-neutral: nothing here is Gmail-specific; `provider` names the client.
 */
export type Provider = "gmail" | "outlook" | "yahoo" | (string & {});

/** shared = one message to many recipients; individual = one tracked copy per recipient. */
export type TrackingMode = "shared" | "individual";

export interface Recipient {
	email: string;
	name?: string;
}

export interface RegisterMessageRequest {
	id: string;
	provider: Provider;
	subject: string;
	recipients: Recipient[];
	links: string[];
	mode: TrackingMode;
	/** Ties together the copies of one individual-mode (or mail merge) send. */
	groupId?: string;
	trackOpens: boolean;
	trackLinks: boolean;
}

export interface MarkSentRequest {
	sentAt: number;
	providerThreadId?: string;
	providerMessageId?: string;
}

export type EventType = "open" | "click";
export type IgnoreReason = "owner" | "send_grace";

export interface TrackingEvent {
	id: number;
	messageId: string;
	type: EventType;
	linkIndex?: number;
	at: number;
	source: EventSource;
	/** Coarse location from Cloudflare (city/country). Off unless STORE_LOCATION=true. */
	location?: string;
	device?: string;
	ignored?: IgnoreReason;
}

export interface MessageSummary {
	id: string;
	provider: Provider;
	subject: string;
	recipients: Recipient[];
	mode: TrackingMode;
	groupId?: string;
	createdAt: number;
	sentAt?: number;
	providerThreadId?: string;
	opens: number;
	machineOpens: number;
	clicks: number;
	firstOpenAt?: number;
	lastEventAt?: number;
}

export interface MessageDetail extends MessageSummary {
	links: string[];
	events: TrackingEvent[];
}

export interface FeedEvent extends TrackingEvent {
	subject: string;
	recipients: Recipient[];
	linkUrl?: string;
}

export interface ListMessagesResponse {
	messages: MessageSummary[];
}

export interface FeedResponse {
	events: FeedEvent[];
	/** Pass back as `since` on the next poll. */
	cursor: number;
}

export interface ThreadStatusResponse {
	/** Keyed by providerThreadId. */
	threads: Record<string, ThreadStatus>;
}

export type ThreadStatusKind =
	| "unopened"
	| "machine_only"
	| "opened"
	| "clicked";

export interface ThreadStatus {
	status: ThreadStatusKind;
	opens: number;
	clicks: number;
	lastEventAt?: number;
	/** Per-recipient status when the thread's copies were sent individually. */
	recipients?: { email: string; status: ThreadStatusKind }[];
}

export interface OwnerViewRequest {
	messageIds: string[];
}

export const API = {
	messages: "/api/messages",
	message: (id: string) => `/api/messages/${id}`,
	sent: (id: string) => `/api/messages/${id}/sent`,
	feed: "/api/feed",
	threadStatus: "/api/thread-status",
	ownerViews: "/api/owner-views",
	health: "/api/health",
} as const;
