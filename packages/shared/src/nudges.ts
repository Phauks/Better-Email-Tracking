import type { Recipient } from "./api";

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
	/** HTML body. Supports {{firstName}}, {{name}}, {{email}} with {{firstName|fallback}}. */
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

export interface ListNudgesResponse {
	sequences: NudgeSequence[];
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

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** First name from a display name, or a capitalised guess from the address local part. */
export function firstNameOf(r: Recipient | undefined): string {
	const name = r?.name?.trim();
	if (name) {
		// "Last, First" → First
		if (name.includes(","))
			return name.split(",")[1]?.trim().split(/\s+/)[0] ?? "";
		return name.split(/\s+/)[0] ?? "";
	}
	return "";
}

const PLACEHOLDER = /\{\{\s*(firstName|name|email)\s*(?:\|([^}]*))?\}\}/g;

/**
 * Fills {{firstName}}, {{name}} and {{email}} from one recipient. `{{firstName|there}}`
 * uses "there" when the value is unknown. With several recipients the fallback is used,
 * since one name would be wrong for the others. Recipient values are HTML-escaped.
 */
export function renderTemplate(
	template: string,
	recipients: Recipient[],
	opts: { html?: boolean } = {},
): string {
	const html = opts.html ?? true;
	const one = recipients.length === 1 ? recipients[0] : undefined;
	return template.replace(
		PLACEHOLDER,
		(_m, key: string, fallback: string | undefined) => {
			let value = "";
			if (one) {
				if (key === "firstName") value = firstNameOf(one);
				else if (key === "name") value = one.name?.trim() ?? "";
				else value = one.email;
			}
			// The fallback is part of the template, so it's already in the template's format.
			if (!value) return (fallback ?? "").trim();
			return html ? escapeHtml(value) : value;
		},
	);
}

/** "Re: subject" without stacking prefixes. */
export function replySubject(subject: string): string {
	const s = subject.trim();
	return /^re:/i.test(s) ? s : `Re: ${s}`;
}
