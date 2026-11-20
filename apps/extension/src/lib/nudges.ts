import {
	type CreateNudgeRequest,
	NUDGE_LIMITS,
	type NudgePolicy,
	type NudgeSequence,
	type NudgeState,
	type Recipient,
	renderNudgeTemplate,
	type SendWindow,
	stepsFromPolicy,
} from "@bet/shared";
import { plural } from "./time";

/** Follow-up defaults, stored with the rest of the settings. */
export interface NudgeDefaults extends NudgePolicy {
	/** Plain text; placeholders like {{firstName|there}} are filled per recipient. */
	text: string;
	stopOnOpen: boolean;
	/** Turn follow-ups on for every new tracked email. */
	enabledByDefault: boolean;
	/** Only send nudges in these local hours, on weekdays if set. */
	window: {
		enabled: boolean;
		startHour: number;
		endHour: number;
		weekdaysOnly: boolean;
	};
}

export const DEFAULT_NUDGES: Readonly<NudgeDefaults> = Object.freeze({
	firstAfterDays: 3,
	intervalDays: 4,
	maxNudges: 3,
	text: "Hi {{firstName|there}},\n\nJust bubbling this up in case it got buried. Any thoughts?\n\nThanks!",
	stopOnOpen: false,
	enabledByDefault: false,
	window: { enabled: true, startHour: 9, endHour: 17, weekdaysOnly: true },
});

const clampInt = (v: unknown, min: number, max: number, fallback: number) =>
	typeof v === "number" && Number.isFinite(v)
		? Math.min(max, Math.max(min, Math.round(v)))
		: fallback;

export function normalizePolicy(
	raw: Partial<NudgePolicy>,
	d: NudgePolicy = DEFAULT_NUDGES,
): NudgePolicy {
	return {
		firstAfterDays: clampInt(
			raw.firstAfterDays,
			1,
			NUDGE_LIMITS.maxAfterDays,
			d.firstAfterDays,
		),
		intervalDays: clampInt(
			raw.intervalDays,
			1,
			NUDGE_LIMITS.maxAfterDays,
			d.intervalDays,
		),
		maxNudges: clampInt(raw.maxNudges, 1, NUDGE_LIMITS.maxSteps, d.maxNudges),
	};
}

export function normalizeNudgeDefaults(raw: unknown): NudgeDefaults {
	const d = DEFAULT_NUDGES;
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
		string,
		unknown
	>;
	const w = (
		typeof r.window === "object" && r.window !== null ? r.window : {}
	) as Record<string, unknown>;
	let startHour = clampInt(w.startHour, 0, 23, d.window.startHour);
	let endHour = clampInt(w.endHour, 1, 24, d.window.endHour);
	if (startHour >= endHour) {
		startHour = d.window.startHour;
		endHour = d.window.endHour;
	}
	return {
		...normalizePolicy(r as Partial<NudgePolicy>),
		text: typeof r.text === "string" && r.text.trim() ? r.text : d.text,
		stopOnOpen: typeof r.stopOnOpen === "boolean" ? r.stopOnOpen : d.stopOnOpen,
		enabledByDefault:
			typeof r.enabledByDefault === "boolean"
				? r.enabledByDefault
				: d.enabledByDefault,
		window: {
			enabled: typeof w.enabled === "boolean" ? w.enabled : d.window.enabled,
			startHour,
			endHour,
			weekdaysOnly:
				typeof w.weekdaysOnly === "boolean"
					? w.weekdaysOnly
					: d.window.weekdaysOnly,
		},
	};
}

/** What the compose popover chose for one email. */
export type FollowUpChoice =
	| { kind: "off" }
	| { kind: "default" }
	| { kind: "custom"; policy: NudgePolicy; text: string; stopOnOpen: boolean };

export interface ResolvedFollowUp {
	policy: NudgePolicy;
	text: string;
	stopOnOpen: boolean;
}

export function resolveChoice(
	choice: FollowUpChoice,
	defaults: NudgeDefaults,
): ResolvedFollowUp | null {
	switch (choice.kind) {
		case "off":
			return null;
		case "default":
			return {
				policy: normalizePolicy(defaults),
				text: defaults.text,
				stopOnOpen: defaults.stopOnOpen,
			};
		case "custom":
			return {
				policy: normalizePolicy(choice.policy, defaults),
				text: choice.text.trim() ? choice.text : defaults.text,
				stopOnOpen: choice.stopOnOpen,
			};
	}
}

/** "After 3 days, then every 4 days · up to 3 nudges" */
export function describePolicy(p: NudgePolicy): string {
	const first = `After ${plural(p.firstAfterDays, "day")}`;
	if (p.maxNudges <= 1) return `${first} · 1 nudge`;
	return `${first}, then every ${plural(p.intervalDays, "day")} · up to ${plural(p.maxNudges, "nudge")}`;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Plain text to simple HTML: paragraphs on blank lines, <br> on single newlines. */
export function textToHtml(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.trim()
		.split(/\n{2,}/)
		.map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
		.join("");
}

/** Plain-text preview of a nudge for one recipient (popover and options page). */
export function previewNudge(text: string, recipients: Recipient[]): string {
	return renderNudgeTemplate(text, recipients, { html: false });
}

export function sendWindowFor(
	defaults: NudgeDefaults,
	timeZone: string | undefined,
): SendWindow | undefined {
	if (!defaults.window.enabled) return undefined;
	const win: SendWindow = {
		startHour: defaults.window.startHour,
		endHour: defaults.window.endHour,
	};
	if (timeZone) win.timeZone = timeZone;
	if (defaults.window.weekdaysOnly) win.weekdaysOnly = true;
	return win;
}

export interface TrackedSendInfo {
	messageId: string;
	sentAt: number;
	providerThreadId?: string;
	to: Recipient[];
	cc: Recipient[];
}

/** The Worker request for one sent, tracked message (one per copy for individual sends). */
export function buildNudgeRequest(
	sent: TrackedSendInfo,
	resolved: ResolvedFollowUp,
	sendWindow?: SendWindow,
): CreateNudgeRequest {
	const req: CreateNudgeRequest = {
		messageId: sent.messageId,
		steps: stepsFromPolicy(resolved.policy, textToHtml(resolved.text)),
		stopOnOpen: resolved.stopOnOpen,
		sentAt: sent.sentAt,
	};
	if (sent.providerThreadId) req.providerThreadId = sent.providerThreadId;
	if (sendWindow) req.sendWindow = sendWindow;
	if (sent.to.length) req.to = sent.to;
	if (sent.cc.length) req.cc = sent.cc;
	return req;
}

export const NUDGE_STATE_LABEL: Record<NudgeState, string> = {
	active: "Scheduled",
	paused: "Paused",
	replied: "Replied",
	opened: "Stopped: opened",
	done: "Finished, no reply",
	cancelled: "Cancelled",
	failed: "Failed",
};

/** Short status line for a sequence, e.g. "Nudge 2 of 3 · Tue, Nov 10, 9:00 AM". */
export function nextActionLabel(
	seq: NudgeSequence,
	fmt: (at: number) => string,
): string {
	if (seq.state === "paused")
		return `Paused before nudge ${seq.nextStep + 1} of ${seq.steps.length}`;
	if (seq.state !== "active") return NUDGE_STATE_LABEL[seq.state];
	if (seq.nextAt === undefined) return "Scheduled";
	if (seq.nextStep >= seq.steps.length)
		return `Last reply check ${fmt(seq.nextAt)}`;
	return `Nudge ${seq.nextStep + 1} of ${seq.steps.length} · ${fmt(seq.nextAt)}`;
}

/** Tracked-message ids of the nudges themselves (hidden from the email list). */
export function nudgeMessageIds(sequences: NudgeSequence[]): Set<string> {
	const ids = new Set<string>();
	for (const s of sequences)
		for (const h of s.history) if (h.nudgeMessageId) ids.add(h.nudgeMessageId);
	return ids;
}
