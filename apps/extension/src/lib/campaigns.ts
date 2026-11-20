import {
	type CampaignDetail,
	type CampaignRecipient,
	type CampaignRecipientInput,
	type CampaignRecipientState,
	type CampaignSettings,
	type CampaignStats,
	type CampaignStatus,
	type CampaignSummary,
	type CreateCampaignRequest,
	type MergeRecipient,
	type MissingPolicy,
	type Provider,
	previewMerge,
	type RowIssue,
} from "@bet/shared";
import type { IconName } from "../ui/icons";

/** Pure helpers behind the dashboard's Mail merge view. */

/** Google's documentation on Gmail sending limits (they differ by account type). */
export const GMAIL_LIMITS_URL = "https://support.google.com/a/answer/166852";
export const GMAIL_LIMITS_CONSUMER_URL =
	"https://support.google.com/mail/answer/22839";

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
	draft: "Draft",
	sending: "Sending",
	paused: "Paused",
	done: "Done",
	cancelled: "Cancelled",
};

export const CAMPAIGN_STATUS_ICON: Record<CampaignStatus, IconName> = {
	draft: "file-csv",
	sending: "paper-plane-tilt",
	paused: "pause",
	done: "check-circle",
	cancelled: "prohibit",
};

/** Recipients that are not sent yet; sent ones show their tracking status instead. */
export const RECIPIENT_STATE_STYLE: Record<
	Exclude<CampaignRecipientState, "sent">,
	{ icon: IconName; label: string; tone: "muted" | "accent" | "danger" }
> = {
	queued: { icon: "clock", label: "Queued", tone: "muted" },
	sending: { icon: "paper-plane-tilt", label: "Sending…", tone: "accent" },
	failed: { icon: "x-circle", label: "Failed", tone: "danger" },
	skipped: { icon: "prohibit", label: "Skipped", tone: "muted" },
};

export function isActive(c: Pick<CampaignSummary, "status">): boolean {
	return c.status === "sending";
}

/** Share of the campaign that has been handled (sent, failed or skipped). */
export function progress(stats: CampaignStats): {
	handled: number;
	total: number;
	pct: number;
} {
	const handled = stats.sent + stats.failed + stats.skipped;
	const total = stats.total;
	return {
		handled,
		total,
		pct: total === 0 ? 0 : Math.round((handled / total) * 100),
	};
}

export function statsLine(s: CampaignStats): string {
	if (s.sent === 0) return `${s.total} recipients`;
	const parts = [`${s.sent} sent`, `${s.opened} opened`];
	if (s.clicked) parts.push(`${s.clicked} clicked`);
	if (s.machineOnly) parts.push(`${s.machineOnly} privacy proxy`);
	if (s.failed) parts.push(`${s.failed} failed`);
	return parts.join(" · ");
}

/** Which actions make sense for a campaign in this state. */
export function campaignActions(
	c: Pick<CampaignSummary, "status" | "stats">,
): ("start" | "pause" | "resume" | "cancel" | "retry")[] {
	const out: ("start" | "pause" | "resume" | "cancel" | "retry")[] = [];
	if (c.status === "draft") out.push("start");
	if (c.status === "sending") out.push("pause");
	if (c.status === "paused") out.push("resume");
	if (
		c.stats.failed > 0 &&
		(c.status === "done" || c.status === "paused" || c.status === "sending")
	)
		out.push("retry");
	if (c.status === "draft" || c.status === "sending" || c.status === "paused")
		out.push("cancel");
	return out;
}

/** Streak-style follow-up: sent recipients nobody (human) has opened yet. */
export function nonOpeners(recipients: CampaignRecipient[]): MergeRecipient[] {
	return recipients
		.filter(
			(r) =>
				r.state === "sent" &&
				(r.status === "unopened" || r.status === "machine_only"),
		)
		.map((r) => {
			const m: MergeRecipient = {
				email: r.email,
				fields: { email: r.email, ...r.fields },
			};
			if (r.name) {
				m.name = r.name;
				m.fields.name ??= r.name;
			}
			return m;
		});
}

export interface BuilderSeed {
	name: string;
	subject: string;
	body: string;
	recipients: MergeRecipient[];
}

export function followUpSeed(c: CampaignDetail): BuilderSeed {
	return {
		name: `Follow-up: ${c.name}`,
		subject: /^re:/i.test(c.subjectTemplate)
			? c.subjectTemplate
			: `Re: ${c.subjectTemplate}`,
		body: "",
		recipients: nonOpeners(c.recipients),
	};
}

/** Field keys available to templates, email and name first. */
export function availableFields(recipients: MergeRecipient[]): string[] {
	const keys = new Set<string>(["email", "name"]);
	for (const r of recipients)
		for (const k of Object.keys(r.fields)) keys.add(k);
	return [...keys];
}

export function issueText(issue: RowIssue): string {
	switch (issue.kind) {
		case "invalid_email":
			return `Row ${issue.row}: "${issue.value}" is not a valid email address`;
		case "duplicate":
			return `Row ${issue.row}: ${issue.value} appears more than once (kept the first)`;
		case "empty":
			return `Row ${issue.row}: empty`;
	}
}

/** Builds the create request. Under the "block" policy, rows with missing fields are skipped. */
export function buildCreateRequest(args: {
	id: string;
	name: string;
	provider: Provider;
	subject: string;
	body: string;
	recipients: MergeRecipient[];
	settings: CampaignSettings;
	start: boolean;
}): CreateCampaignRequest {
	const policy: MissingPolicy = args.settings.missingPolicy;
	const rows = previewMerge(
		{ subject: args.subject, body: args.body },
		args.recipients,
		policy,
	);
	const recipients: CampaignRecipientInput[] = rows.map((row) => {
		const r: CampaignRecipientInput = {
			email: row.recipient.email,
			fields: row.recipient.fields,
		};
		if (row.recipient.name) r.name = row.recipient.name;
		if (row.blocked) r.skipReason = `Missing: ${row.missing.join(", ")}`;
		return r;
	});
	return {
		id: args.id,
		name: args.name.trim() || "Untitled campaign",
		provider: args.provider,
		subjectTemplate: args.subject,
		bodyTemplate: args.body,
		settings: args.settings,
		status: args.start ? "sending" : "draft",
		recipients,
	};
}

/** Rough duration of a run, in minutes, using the average delay. */
export function estimateMinutes(
	count: number,
	s: Pick<CampaignSettings, "minDelaySec" | "maxDelaySec" | "perRunCap">,
): number {
	const n = Math.min(count, s.perRunCap);
	if (n <= 1) return 0;
	return Math.ceil(((n - 1) * (s.minDelaySec + s.maxDelaySec)) / 2 / 60);
}
