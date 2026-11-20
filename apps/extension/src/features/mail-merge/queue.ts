import type {
	CampaignDetail,
	CampaignRecipient,
	CampaignSettings,
	CampaignSummary,
	Provider,
} from "@bet/shared";

/** Pure queue decisions for the mail merge sender. The runner does the I/O. */

/** Random delay between sends, uniform in [minDelaySec, maxDelaySec]. */
export function nextDelayMs(
	s: Pick<CampaignSettings, "minDelaySec" | "maxDelaySec">,
	random: () => number = Math.random,
): number {
	const min = Math.max(0, s.minDelaySec);
	const max = Math.max(min, s.maxDelaySec);
	return Math.round((min + (max - min) * random()) * 1000);
}

/**
 * When the next copy may go out. After a reload the last send time comes from the
 * Worker, so a resumed run still keeps its spacing.
 */
export function nextSendAt(
	lastSentAt: number | undefined,
	delayMs: number,
	now: number,
): number {
	if (lastSentAt === undefined) return now;
	return Math.max(now, lastSentAt + delayMs);
}

/** The lease outlives the longest wait plus a slow send, and is renewed every step. */
export function leaseTtlMs(s: Pick<CampaignSettings, "maxDelaySec">): number {
	return s.maxDelaySec * 1000 + 3 * 60_000;
}

export type QueueStep =
	| { kind: "stop"; reason: "not_sending" }
	| { kind: "done" }
	| { kind: "cap"; reason: string }
	/** Claimed by an earlier run that never reported back: outcome unknown. */
	| { kind: "interrupted"; recipient: CampaignRecipient }
	| { kind: "send"; recipient: CampaignRecipient };

/** What to do next for a campaign, given how many copies this run has sent. */
export function nextStep(
	campaign: Pick<CampaignDetail, "status" | "recipients" | "settings">,
	sentThisRun: number,
): QueueStep {
	if (campaign.status !== "sending")
		return { kind: "stop", reason: "not_sending" };
	const stale = campaign.recipients.find((r) => r.state === "sending");
	if (stale) return { kind: "interrupted", recipient: stale };
	const next = campaign.recipients.find((r) => r.state === "queued");
	if (!next) return { kind: "done" };
	if (sentThisRun >= campaign.settings.perRunCap)
		return { kind: "cap", reason: capReason(campaign.settings.perRunCap) };
	return { kind: "send", recipient: next };
}

export function capReason(cap: number): string {
	return `Run cap of ${cap} reached. Resume to send the next batch.`;
}

export const INTERRUPTED_ERROR =
	"Interrupted while sending (tab closed or reloaded). Check your Sent folder before retrying.";

/** Campaigns this mail client should send, oldest first. */
export function campaignsToRun(
	campaigns: CampaignSummary[],
	provider: Provider,
): CampaignSummary[] {
	return campaigns
		.filter((c) => c.status === "sending" && c.provider === provider)
		.sort((a, b) => a.createdAt - b.createdAt);
}

/** Pause after this many failures in a row (likely a sending limit or a broken compose). */
export const MAX_CONSECUTIVE_FAILURES = 3;
