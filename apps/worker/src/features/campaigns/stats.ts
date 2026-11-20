import type {
	CampaignDetail,
	CampaignFollowUpStats,
	CampaignRecipient,
	CampaignStats,
	CampaignSummary,
	RecipientFollowUp,
} from "@bet/shared";
import type {
	Counts,
	GroupEngagement,
	StoredMessage,
} from "../../core/store/types";
import { EMPTY_COUNTS, statusOf } from "../../core/summary";
import type {
	StateCounts,
	StoredCampaign,
	StoredRecipient,
} from "./store/types";

/**
 * A campaign's stats: recipient states from its queue, engagement from the SQL
 * aggregate over its sent copies (campaign id = groupId; nudges excluded).
 */
export function campaignStats(
	states: StateCounts,
	engagement: GroupEngagement | undefined,
): CampaignStats {
	return {
		total:
			states.queued +
			states.sending +
			states.sent +
			states.failed +
			states.skipped,
		queued: states.queued,
		sending: states.sending,
		sent: states.sent,
		failed: states.failed,
		skipped: states.skipped,
		opened: engagement?.opened ?? 0,
		clicked: engagement?.clicked ?? 0,
		machineOnly: engagement?.machineOnly ?? 0,
		unopened: engagement?.unopened ?? 0,
	};
}

export function toCampaignSummary(
	c: StoredCampaign,
	stats: CampaignStats,
	lastSentAt?: number,
): CampaignSummary {
	const s: CampaignSummary = {
		id: c.id,
		name: c.name,
		provider: c.provider,
		subjectTemplate: c.subjectTemplate,
		status: c.status,
		settings: c.settings,
		createdAt: c.createdAt,
		updatedAt: c.updatedAt,
		stats,
	};
	if (c.pauseReason) s.pauseReason = c.pauseReason;
	if (lastSentAt !== undefined) s.lastSentAt = lastSentAt;
	if (c.followUp) s.followUp = c.followUp;
	return s;
}

/** Per-recipient rows with the tracking status and follow-up of each sent copy. */
export function toCampaignRecipients(
	recipients: StoredRecipient[],
	messagesById: Map<string, StoredMessage>,
	counts: Map<string, Counts>,
	followUps: Map<string, RecipientFollowUp> = new Map(),
): CampaignRecipient[] {
	return recipients.map((r) => {
		const out: CampaignRecipient = {
			email: r.email,
			fields: r.fields,
			state: r.state,
		};
		if (r.name) out.name = r.name;
		if (r.messageId) out.messageId = r.messageId;
		if (r.error) out.error = r.error;
		if (r.sentAt !== undefined) out.sentAt = r.sentAt;
		const m = r.messageId ? messagesById.get(r.messageId) : undefined;
		if (m && r.state === "sent") {
			const c = counts.get(m.id) ?? EMPTY_COUNTS;
			out.status = statusOf(c);
			out.opens = c.opens;
			out.clicks = c.clicks;
			const f = followUps.get(m.id);
			if (f) out.followUp = f;
		}
		return out;
	});
}

export function toCampaignDetail(
	summary: CampaignSummary,
	c: StoredCampaign,
	recipients: CampaignRecipient[],
	extra: {
		recipientsNextCursor?: string;
		followUpStats?: CampaignFollowUpStats;
	} = {},
): CampaignDetail {
	const d: CampaignDetail = {
		...summary,
		bodyTemplate: c.bodyTemplate,
		recipients,
	};
	if (extra.recipientsNextCursor)
		d.recipientsNextCursor = extra.recipientsNextCursor;
	if (extra.followUpStats) d.followUpStats = extra.followUpStats;
	return d;
}
