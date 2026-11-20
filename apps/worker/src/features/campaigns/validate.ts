import {
	type CampaignAction,
	type CampaignFollowUpAction,
	type CampaignLeaseRequest,
	type CampaignRecipientInput,
	type CampaignRecipientState,
	type CampaignSettings,
	type CreateCampaignRequest,
	DEFAULT_CAMPAIGN_SETTINGS,
	decodeCursor,
	isValidEmail,
	isValidId,
	CAMPAIGN_LIMITS as L,
	PAGE_LIMITS,
	type RecipientResultRequest,
	type UpdateCampaignRequest,
} from "@bet/shared";
import {
	clampInt,
	fail,
	intParam,
	isObject,
	type Parsed,
} from "../../lib/parse";
import { parseFollowUpPolicy, type SequenceSpec } from "../nudges/public";
import type { RecipientPageQuery } from "./store/types";

export function parseSettings(v: unknown): CampaignSettings {
	const raw = isObject(v) ? v : {};
	const d = DEFAULT_CAMPAIGN_SETTINGS;
	const minDelaySec = clampInt(
		raw.minDelaySec,
		d.minDelaySec,
		L.minDelaySec,
		L.maxDelaySec,
	);
	return {
		trackLinks: raw.trackLinks !== false,
		minDelaySec,
		maxDelaySec: clampInt(
			raw.maxDelaySec,
			Math.max(d.maxDelaySec, minDelaySec),
			minDelaySec,
			L.maxDelaySec,
		),
		perRunCap: clampInt(raw.perRunCap, d.perRunCap, 1, L.maxPerRunCap),
		missingPolicy: raw.missingPolicy === "warn" ? "warn" : "block",
	};
}

function parseRecipient(r: unknown): CampaignRecipientInput | string {
	if (!isObject(r) || typeof r.email !== "string" || !isValidEmail(r.email))
		return "invalid recipient email";
	if (r.name !== undefined && typeof r.name !== "string")
		return "invalid recipient name";
	const fields: Record<string, string> = {};
	if (r.fields !== undefined) {
		if (!isObject(r.fields)) return "invalid recipient fields";
		const entries = Object.entries(r.fields);
		if (entries.length > L.maxFields) return "too many fields";
		for (const [k, v] of entries) {
			if (typeof v !== "string" || k.length > 64) return "invalid field";
			fields[k] = v.slice(0, L.maxFieldLength);
		}
	}
	const out: CampaignRecipientInput = { email: r.email.trim(), fields };
	if (typeof r.name === "string" && r.name.trim())
		out.name = r.name.trim().slice(0, L.maxName);
	if (typeof r.skipReason === "string" && r.skipReason)
		out.skipReason = r.skipReason.slice(0, 500);
	return out;
}

export type CreateCampaignInput = Omit<CreateCampaignRequest, "followUp"> & {
	followUp?: SequenceSpec;
};

export function parseCreateCampaign(
	body: unknown,
): Parsed<CreateCampaignInput> {
	if (!isObject(body)) return fail("body must be an object");
	const { id, name, provider, subjectTemplate, bodyTemplate, status } = body;
	if (typeof id !== "string" || !isValidId(id)) return fail("invalid id");
	if (typeof name !== "string") return fail("invalid name");
	if (typeof provider !== "string" || !provider || provider.length > 32)
		return fail("invalid provider");
	if (typeof subjectTemplate !== "string" || subjectTemplate.length > 998)
		return fail("invalid subjectTemplate");
	if (typeof bodyTemplate !== "string" || bodyTemplate.length > L.maxBody)
		return fail("invalid bodyTemplate");
	if (status !== "draft" && status !== "sending") return fail("invalid status");
	if (
		!Array.isArray(body.recipients) ||
		body.recipients.length === 0 ||
		body.recipients.length > L.maxRecipients
	)
		return fail(`recipients must be 1 to ${L.maxRecipients} entries`);
	const recipients: CampaignRecipientInput[] = [];
	const seen = new Set<string>();
	for (const raw of body.recipients) {
		const r = parseRecipient(raw);
		if (typeof r === "string") return fail(r);
		const key = r.email.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		recipients.push(r);
	}
	const followUp = parseFollowUpPolicy(body.followUp);
	if (!followUp.ok) return followUp;
	const value: CreateCampaignInput = {
		id,
		name: name.trim().slice(0, L.maxName) || "Untitled campaign",
		provider,
		subjectTemplate,
		bodyTemplate,
		status,
		settings: parseSettings(body.settings),
		recipients,
	};
	if (followUp.value) value.followUp = followUp.value;
	return { ok: true, value };
}

const ACTIONS: CampaignAction[] = [
	"start",
	"pause",
	"resume",
	"cancel",
	"retry",
];

export function parseUpdateCampaign(
	body: unknown,
): Parsed<UpdateCampaignRequest> {
	if (!isObject(body) || !ACTIONS.includes(body.action as CampaignAction))
		return fail("invalid action");
	const value: UpdateCampaignRequest = {
		action: body.action as CampaignAction,
	};
	if (typeof body.reason === "string" && body.reason)
		value.reason = body.reason.slice(0, 200);
	return { ok: true, value };
}

export function parseRecipientResult(
	body: unknown,
): Parsed<RecipientResultRequest> {
	if (!isObject(body)) return fail("body must be an object");
	const { state, messageId, error, sentAt, providerThreadId } = body;
	if (
		state !== "sending" &&
		state !== "sent" &&
		state !== "failed" &&
		state !== "skipped"
	)
		return fail("invalid state");
	const value: RecipientResultRequest = { state };
	if (messageId !== undefined && messageId !== null) {
		if (typeof messageId !== "string" || !isValidId(messageId))
			return fail("invalid messageId");
		value.messageId = messageId;
	}
	if (typeof error === "string" && error) value.error = error.slice(0, 500);
	if (sentAt !== undefined) {
		if (typeof sentAt !== "number" || !Number.isFinite(sentAt) || sentAt <= 0)
			return fail("invalid sentAt");
		value.sentAt = sentAt;
	}
	if (
		typeof providerThreadId === "string" &&
		providerThreadId.trim() &&
		providerThreadId.length <= 256
	)
		value.providerThreadId = providerThreadId.trim();
	return { ok: true, value };
}

export function parseLease(body: unknown): Parsed<CampaignLeaseRequest> {
	if (!isObject(body)) return fail("body must be an object");
	const { runnerId, ttlMs } = body;
	if (typeof runnerId !== "string" || !isValidId(runnerId))
		return fail("invalid runnerId");
	return {
		ok: true,
		value: { runnerId, ttlMs: clampInt(ttlMs, 120_000, 10_000, 2 * 3_600_000) },
	};
}

const RECIPIENT_STATES: CampaignRecipientState[] = [
	"queued",
	"sending",
	"sent",
	"failed",
	"skipped",
];

/** ?state=a,b&q=&cursor=&limit= for a campaign's recipients. */
export function parseRecipientQuery(
	query: (name: string) => string | undefined,
): Parsed<RecipientPageQuery> {
	const { default: def, max } = PAGE_LIMITS.recipients;
	const value: RecipientPageQuery = {
		limit: intParam(query("limit"), def, 1, max),
	};
	const cursorRaw = query("cursor");
	if (cursorRaw) {
		const cursor = decodeCursor(cursorRaw, ["number"] as const);
		if (!cursor) return fail("invalid cursor");
		value.afterPosition = cursor[0];
	}
	const stateRaw = query("state");
	if (stateRaw) {
		const states = stateRaw.split(",").map((s) => s.trim());
		if (!states.every((s) => RECIPIENT_STATES.includes(s as never)))
			return fail("invalid state");
		value.states = states as CampaignRecipientState[];
	}
	const q = query("q")?.trim().slice(0, 200);
	if (q) value.q = q;
	return { ok: true, value };
}

export function parseFollowUpAction(
	body: unknown,
): Parsed<CampaignFollowUpAction> {
	if (!isObject(body)) return fail("body must be an object");
	const { action } = body;
	if (action !== "pause" && action !== "resume" && action !== "cancel")
		return fail("action must be pause, resume or cancel");
	return { ok: true, value: action };
}
