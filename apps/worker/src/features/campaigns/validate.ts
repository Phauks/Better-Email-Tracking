import {
	type CampaignAction,
	type CampaignLeaseRequest,
	type CampaignRecipientInput,
	type CampaignSettings,
	type CreateCampaignRequest,
	DEFAULT_CAMPAIGN_SETTINGS,
	isValidEmail,
	isValidId,
	CAMPAIGN_LIMITS as L,
	type RecipientResultRequest,
	type UpdateCampaignRequest,
} from "@bet/shared";
import { clampInt, fail, isObject, type Parsed } from "../../lib/parse";

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

export function parseCreateCampaign(
	body: unknown,
): Parsed<CreateCampaignRequest> {
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
	return {
		ok: true,
		value: {
			id,
			name: name.trim().slice(0, L.maxName) || "Untitled campaign",
			provider,
			subjectTemplate,
			bodyTemplate,
			status,
			settings: parseSettings(body.settings),
			recipients,
		},
	};
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
	const { state, messageId, error, sentAt } = body;
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
