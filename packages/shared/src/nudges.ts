import type { Recipient } from "./api";
import { fieldKey } from "./merge";
import type { Paged } from "./pagination";
import { firstName } from "./text";

/**
 * Follow-up nudges: the Worker replies in the original thread until someone answers.
 * Provider-neutral: the Worker talks to the mailbox through a connector (Google today).
 */

/** Feed-only event types. They never count as opens or clicks. */
export type NudgeEventType = "nudge_sent" | "reply";

export type NudgeState =
	| "active" // waiting for the next nudge
	| "paused"
	| "replied" // someone answered: stopped
	| "opened" // stopOnOpen and the recipient opened: stopped
	| "done" // every nudge was sent
	| "cancelled"
	| "failed"; // gave up after repeated errors, or the address bounced

export const NUDGE_FINAL_STATES: readonly NudgeState[] = [
	"replied",
	"opened",
	"done",
	"cancelled",
	"failed",
];

export interface NudgeStep {
	/** Days after the previous send (the original email for the first step). */
	afterDays: number;
	/**
	 * HTML body, rendered with the mail merge template engine ({{field}},
	 * {{field|fallback}}): firstName, name and email are always available, and a mail
	 * merge copy's own fields too. See nudgeFields.
	 */
	html: string;
}

/** Simple policy: first nudge after N days, then every M days, up to K nudges. */
export interface NudgePolicy {
	firstAfterDays: number;
	intervalDays: number;
	maxNudges: number;
}

/** Only send between these local hours (start inclusive, end exclusive). */
export interface SendWindow {
	startHour: number;
	endHour: number;
	/** IANA time zone, e.g. "Europe/London". Defaults to UTC. */
	timeZone?: string;
	weekdaysOnly?: boolean;
}

export interface CreateNudgeRequest {
	messageId: string;
	/** Explicit steps, or a policy with one template used for every nudge. */
	steps?: NudgeStep[];
	firstAfterDays?: number;
	intervalDays?: number;
	maxNudges?: number;
	template?: string;
	/** Also stop once the recipient opens (default false). Replies always stop. */
	stopOnOpen?: boolean;
	sendWindow?: SendWindow;
	/** Who nudges go to (the original's visible To/CC). Defaults to the message recipients. BCC: never. */
	to?: Recipient[];
	cc?: Recipient[];
	/** Lets the extension create a sequence before its markSent call lands. */
	providerThreadId?: string;
	sentAt?: number;
	/** Replace an existing active sequence for this message instead of returning it. */
	replace?: boolean;
}

export type NudgeAction = "pause" | "resume";

export interface UpdateNudgeRequest {
	action?: NudgeAction;
	steps?: NudgeStep[];
	stopOnOpen?: boolean;
	sendWindow?: SendWindow | null;
}

export type NudgeHistoryKind =
	| "sent"
	| "reply"
	| "opened"
	| "bounced"
	| "error"
	| "paused"
	| "resumed"
	| "cancelled"
	| "created";

export interface NudgeHistoryItem {
	at: number;
	kind: NudgeHistoryKind;
	step?: number;
	/** Tracked message id of the nudge itself (its own pixel). */
	nudgeMessageId?: string;
	detail?: string;
}

export interface NudgeSequence {
	id: string;
	messageId: string;
	/** The original message's groupId (a mail merge campaign's id), if any. */
	groupId?: string;
	connector: string;
	providerThreadId: string;
	state: NudgeState;
	steps: NudgeStep[];
	/** Index of the next step to send. */
	nextStep: number;
	nextAt?: number;
	stopOnOpen: boolean;
	sendWindow?: SendWindow;
	createdAt: number;
	updatedAt: number;
	attempts: number;
	lastError?: string;
	/** Joined from the original message. */
	subject: string;
	recipients: Recipient[];
	history: NudgeHistoryItem[];
}

export interface ListNudgesResponse extends Paged {
	sequences: NudgeSequence[];
}

/** Filters for GET /api/nudges (plus cursor and limit). */
export interface ListNudgesQuery {
	state?: NudgeState;
	messageId?: string;
	/** Sequences of one send group (a mail merge campaign's id). */
	groupId?: string;
}

export interface NudgeResponse {
	sequence: NudgeSequence;
}

export type ConnectorKind = "google" | (string & {});

export interface ConnectorStatus {
	kind: ConnectorKind;
	/** Server secrets for this connector are set. */
	configured: boolean;
	connected: boolean;
	email?: string;
	connectedAt?: number;
}

export interface ConnectorStatusResponse {
	connectors: ConnectorStatus[];
}

export interface StartConnectorResponse {
	url: string;
}

export const NUDGE_API = {
	nudges: "/api/nudges",
	nudge: (id: string) => `/api/nudges/${id}`,
	connectorStatus: "/api/connectors/status",
	connectorStart: (kind: ConnectorKind) => `/api/connectors/${kind}/start`,
	connector: (kind: ConnectorKind) => `/api/connectors/${kind}`,
	oauthCallback: (kind: ConnectorKind) => `/oauth/${kind}/callback`,
} as const;

export const NUDGE_LIMITS = {
	maxSteps: 10,
	maxAfterDays: 90,
	maxHtml: 20_000,
} as const;

/** Expands a policy into steps that all use the same body. */
export function stepsFromPolicy(
	policy: NudgePolicy,
	html: string,
): NudgeStep[] {
	const n = Math.max(0, Math.min(NUDGE_LIMITS.maxSteps, policy.maxNudges));
	return Array.from({ length: n }, (_, i) => ({
		afterDays: i === 0 ? policy.firstAfterDays : policy.intervalDays,
		html,
	}));
}

/** First name from a recipient's display name ("" when there is none). */
export function firstNameOf(r: Recipient | undefined): string {
	const name = r?.name?.trim();
	return name ? firstName(name) : "";
}

/**
 * Template values for a nudge, for the shared merge engine (renderTemplate). With one
 * recipient: email, name, first_name (alias firstName, as older nudge templates
 * write it) and any merge fields of a mail merge copy, whose own first_name column
 * wins over the one derived from the name. With several recipients only merge fields
 * are set, so {{firstName|there}} falls back rather than naming the wrong person.
 *
 * Render nudge HTML with `{ html: true, escapeFallbacks: false }`: the nudge text was
 * already converted to HTML (fallbacks included).
 */
export function nudgeFields(
	recipients: Recipient[],
	mergeFields: Record<string, string> = {},
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(mergeFields)) {
		const key = fieldKey(k);
		if (key && typeof v === "string") out[key] = v;
	}
	const one = recipients.length === 1 ? recipients[0] : undefined;
	if (one) {
		out.email = one.email;
		const name = one.name?.trim() || out.name?.trim() || "";
		if (name) out.name = name;
		const first = out.first_name?.trim() || firstNameOf({ email: "", name });
		if (first) out.first_name = first;
	}
	// fieldKey("firstName") is "firstname": keep the camelCase spelling working.
	if (out.first_name && !out.firstname) out.firstname = out.first_name;
	return out;
}

/** "Re: subject" without stacking prefixes. */
export function replySubject(subject: string): string {
	const s = subject.trim();
	return /^re:/i.test(s) ? s : `Re: ${s}`;
}
