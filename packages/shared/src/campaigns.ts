import type { Provider, ThreadStatusKind } from "./api";
import type { MissingPolicy } from "./merge";

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
}

export interface CampaignDetail extends CampaignSummary {
	bodyTemplate: string;
	recipients: CampaignRecipient[];
}

export interface ListCampaignsResponse {
	campaigns: CampaignSummary[];
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
	lease: (id: string) => `/api/campaigns/${id}/lease`,
	recipientResult: (id: string, email: string) =>
		`/api/campaigns/${id}/recipients/${encodeURIComponent(email.toLowerCase())}/result`,
} as const;
