import type {
	CampaignRecipientState,
	CampaignSettings,
	CampaignStatus,
	Provider,
} from "@bet/shared";

/** A campaign as persisted. Times are epoch milliseconds. */
export interface StoredCampaign {
	id: string;
	name: string;
	provider: Provider;
	subjectTemplate: string;
	bodyTemplate: string;
	status: CampaignStatus;
	pauseReason?: string;
	settings: CampaignSettings;
	total: number;
	createdAt: number;
	updatedAt: number;
	runnerId?: string;
	leaseUntil?: number;
}

export interface StoredRecipient {
	campaignId: string;
	position: number;
	/** Lowercased; unique within a campaign. */
	email: string;
	name?: string;
	fields: Record<string, string>;
	state: CampaignRecipientState;
	messageId?: string;
	error?: string;
	sentAt?: number;
	updatedAt: number;
}

export type NewCampaign = Omit<StoredCampaign, "runnerId" | "leaseUntil">;
export type NewRecipient = Omit<StoredRecipient, "campaignId">;

export type StateCounts = Record<CampaignRecipientState, number>;

export interface RecipientPatch {
	state: CampaignRecipientState;
	messageId?: string | null;
	error?: string | null;
	sentAt?: number | null;
}

/**
 * Persistence for campaigns, separate from the core message Store so the feature stays
 * self-contained. D1CampaignStore in production, MemoryCampaignStore in tests.
 */
export interface CampaignStore {
	create(campaign: NewCampaign, recipients: NewRecipient[]): Promise<void>;
	get(id: string): Promise<StoredCampaign | null>;
	/** Newest first. */
	list(limit: number, status?: CampaignStatus): Promise<StoredCampaign[]>;
	recipients(id: string): Promise<StoredRecipient[]>;
	getRecipient(id: string, email: string): Promise<StoredRecipient | null>;
	/** Per-state counts and the latest sentAt for each campaign. */
	counts(
		ids: string[],
	): Promise<Map<string, { states: StateCounts; lastSentAt?: number }>>;
	/** Sets status only when the current status is one of `from`. */
	setStatus(
		id: string,
		status: CampaignStatus,
		from: CampaignStatus[],
		now: number,
		pauseReason?: string,
	): Promise<boolean>;
	/** Updates one recipient only when its current state is one of `from`. */
	updateRecipient(
		id: string,
		email: string,
		from: CampaignRecipientState[],
		patch: RecipientPatch,
		now: number,
	): Promise<boolean>;
	/** Moves every recipient in a `from` state to `to`, clearing messageId and error for "queued". */
	moveRecipients(
		id: string,
		from: CampaignRecipientState[],
		to: CampaignRecipientState,
		now: number,
		error?: string,
	): Promise<number>;
	/** Grants the send lease if it is free, expired, or already held by this runner. */
	acquireLease(
		id: string,
		runnerId: string,
		until: number,
		now: number,
	): Promise<boolean>;
	delete(id: string): Promise<boolean>;
	/** Deletes campaigns (and their recipients) last updated before cutoff. */
	purgeBefore(cutoff: number): Promise<number>;
}

export function emptyCounts(): StateCounts {
	return { queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
}
