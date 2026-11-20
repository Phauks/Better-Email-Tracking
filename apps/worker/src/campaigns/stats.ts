import type {
	CampaignDetail,
	CampaignRecipient,
	CampaignStats,
	CampaignSummary,
} from "@bet/shared";
import { countEvents, statusOf } from "../services/summary";
import type { StoredEvent, StoredMessage } from "../store/types";
import type { StateCounts, StoredCampaign, StoredRecipient } from "./store";

/**
 * Engagement of a campaign's sent copies, computed from the ordinary message/event
 * summaries of its group (campaign id = groupId). Unsent registrations don't count.
 */
export function campaignStats(
	states: StateCounts,
	groupMessages: StoredMessage[],
	eventsByMessage: Map<string, StoredEvent[]>,
): CampaignStats {
	const stats: CampaignStats = {
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
		opened: 0,
		clicked: 0,
		machineOnly: 0,
		unopened: 0,
	};
	for (const m of groupMessages) {
		if (m.sentAt === undefined) continue;
		switch (statusOf(countEvents(eventsByMessage.get(m.id) ?? []))) {
			case "clicked":
				stats.clicked++;
				stats.opened++;
				break;
			case "opened":
				stats.opened++;
				break;
			case "machine_only":
				stats.machineOnly++;
				break;
			default:
				stats.unopened++;
		}
	}
	return stats;
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
	return s;
}

/** Per-recipient rows with the tracking status of each recipient's copy. */
export function toCampaignRecipients(
	recipients: StoredRecipient[],
	messagesById: Map<string, StoredMessage>,
	eventsByMessage: Map<string, StoredEvent[]>,
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
			const c = countEvents(eventsByMessage.get(m.id) ?? []);
			out.status = statusOf(c);
			out.opens = c.opens;
			out.clicks = c.clicks;
		}
		return out;
	});
}

export function toCampaignDetail(
	summary: CampaignSummary,
	c: StoredCampaign,
	recipients: CampaignRecipient[],
): CampaignDetail {
	return { ...summary, bodyTemplate: c.bodyTemplate, recipients };
}
