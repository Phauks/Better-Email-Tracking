import type { Provider, ThreadStatusKind } from "./api";
import type { MissingPolicy } from "./merge";
import type { NudgeState, NudgeStep, SendWindow } from "./nudges";
import type { Paged } from "./pagination";

/**
 * HTTP contract for mail merge campaigns. A campaign's id is the groupId of every
 * tracked copy it sends, so its stats come from the ordinary message/event summaries.
 */
export type CampaignStatus =
	| "draft"
	| "sending"
	| "paused"
	| "done"
	| "cancelled";

/**
 * queued: waiting; sending: claimed by a sender (outcome unknown if it stays here);
 * sent / failed / skipped: final (failed can be retried).
 */
export type CampaignRecipientState =
	| "queued"
	| "sending"
	| "sent"
	| "failed"
	| "skipped";

export interface CampaignSettings {
	trackLinks: boolean;
	/** Random delay between two sends, in seconds. */
	minDelaySec: number;
	maxDelaySec: number;
	/** At most this many sends per run; the campaign then pauses until resumed. */
	perRunCap: number;
	missingPolicy: MissingPolicy;
}

export const DEFAULT_CAMPAIGN_SETTINGS: Readonly<CampaignSettings> =
	Object.freeze({
		trackLinks: true,
		minDelaySec: 20,
		maxDelaySec: 40,
		perRunCap: 50,
		missingPolicy: "block",
	});

export const CAMPAIGN_LIMITS = {
	maxRecipients: 2000,
	maxFields: 50,
	maxFieldLength: 2000,
	maxBody: 100_000,
	maxName: 200,
	minDelaySec: 5,
	maxDelaySec: 3600,
	maxPerRunCap: 500,
} as const;

export interface CampaignRecipientInput {
	email: string;
	name?: string;
	fields: Record<string, string>;
	/** Create as skipped (e.g. blocked by missing fields), with the reason. */
	skipReason?: string;
}

/**
 * "Follow up until reply" for every copy of a campaign. When a copy is confirmed sent
 * the Worker starts a nudge sequence for it (see nudges.ts); nudge steps can use the
 * copy's merge fields. Needs a connected mailbox (GET /api/connectors/status).
 */
export interface CampaignFollowUpPolicy {
	steps: NudgeStep[];
	/** Also stop once the recipient opens (replies always stop). */
	stopOnOpen: boolean;
	sendWindow?: SendWindow;
}

/** paused: copies sent meanwhile get a paused sequence; cancelled: no new sequences. */
export type CampaignFollowUpState = "active" | "paused" | "cancelled";

export interface CampaignFollowUp extends CampaignFollowUpPolicy {
	state: CampaignFollowUpState;
}

/** A recipient's follow-up sequence, once their copy went out. */
export interface RecipientFollowUp {
	sequenceId: string;
	state: NudgeState;
	/** Nudges sent so far. */
	sent: number;
	/** Nudges planned in total. */
	steps: number;
	nextAt?: number;
}

/** Follow-up sequences of a campaign by state, and nudges sent across them. */
export interface CampaignFollowUpStats {
	sequences: number;
	states: Partial<Record<NudgeState, number>>;
	nudgesSent: number;
}

export type CampaignFollowUpAction = "pause" | "resume" | "cancel";

export interface CampaignFollowUpActionRequest {
	action: CampaignFollowUpAction;
}

export interface CampaignFollowUpActionResponse {
	/** Sequences changed. */
	changed: number;
	followUp?: CampaignFollowUp;
}

export interface CreateCampaignRequest {
	id: string;
	name: string;
	provider: Provider;
	subjectTemplate: string;
	bodyTemplate: string;
	settings: CampaignSettings;
	/** "sending" starts right away; "draft" waits for a start action. */
	status: "draft" | "sending";
	recipients: CampaignRecipientInput[];
	/** Follow up until reply; omit for none. */
	followUp?: CampaignFollowUpPolicy;
}

export interface CampaignStats {
	total: number;
	queued: number;
	/** Includes recipients currently being sent. */
	sending: number;
	sent: number;
	failed: number;
	skipped: number;
	/** Of sent copies: opened or clicked by a likely human. */
	opened: number;
	clicked: number;
	/** Opened only by a privacy proxy or scanner. */
	machineOnly: number;
	unopened: number;
}

export interface CampaignSummary {
	id: string;
	name: string;
	provider: Provider;
	subjectTemplate: string;
	status: CampaignStatus;
	pauseReason?: string;
	settings: CampaignSettings;
	createdAt: number;
	updatedAt: number;
	lastSentAt?: number;
	stats: CampaignStats;
	followUp?: CampaignFollowUp;
}

export interface CampaignRecipient {
	email: string;
	name?: string;
	fields: Record<string, string>;
	state: CampaignRecipientState;
	messageId?: string;
	error?: string;
	sentAt?: number;
	/** Tracking status of the sent copy. */
	status?: ThreadStatusKind;
	opens?: number;
	clicks?: number;
	followUp?: RecipientFollowUp;
}

/**
 * Detail with the first page of recipients (in send order, filtered like
 * GET /api/campaigns/:id/recipients). More with that route and `recipientsNextCursor`.
 */
export interface CampaignDetail extends CampaignSummary {
	bodyTemplate: string;
	recipients: CampaignRecipient[];
	recipientsNextCursor?: string;
	/** Present when the campaign has a follow-up policy. */
	followUpStats?: CampaignFollowUpStats;
}

export interface ListCampaignsResponse extends Paged {
	campaigns: CampaignSummary[];
}

/** Filters for a campaign's recipients (detail and recipients routes). */
export interface RecipientQuery {
	/** Only these states. */
	state?: CampaignRecipientState[];
	/** Case-insensitive substring of email or name. */
	q?: string;
	cursor?: string;
	limit?: number;
}

export interface ListRecipientsResponse extends Paged {
	recipients: CampaignRecipient[];
}

export type CampaignAction = "start" | "pause" | "resume" | "cancel" | "retry";

export interface UpdateCampaignRequest {
	action: CampaignAction;
	/** Shown in the dashboard for a pause (e.g. "Run cap of 50 reached"). */
	reason?: string;
}

export interface RecipientResultRequest {
	state: Exclude<CampaignRecipientState, "queued">;
	messageId?: string;
	error?: string;
	sentAt?: number;
	/** The sent copy's thread, so its follow-up can start even if markSent was lost. */
	providerThreadId?: string;
}

export interface RecipientResultResponse {
	ok: true;
	campaignStatus: CampaignStatus;
}

/** One sender at a time: a tab must hold the lease to send for a campaign. */
export interface CampaignLeaseRequest {
	runnerId: string;
	ttlMs: number;
}

export interface CampaignLeaseResponse {
	ok: boolean;
	leaseUntil?: number;
}

export const CAMPAIGN_API = {
	campaigns: "/api/campaigns",
	campaign: (id: string) => `/api/campaigns/${id}`,
	recipients: (id: string) => `/api/campaigns/${id}/recipients`,
	followUps: (id: string) => `/api/campaigns/${id}/follow-ups`,
	lease: (id: string) => `/api/campaigns/${id}/lease`,
	recipientResult: (id: string, email: string) =>
		`/api/campaigns/${id}/recipients/${encodeURIComponent(email.toLowerCase())}/result`,
} as const;
