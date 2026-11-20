import {
	isValidId,
	type MarkSentRequest,
	type OwnerViewRequest,
	type Recipient,
	type RegisterMessageRequest,
} from "@bet/shared";
import {
	fail,
	isHttpUrl,
	isObject,
	optString,
	type Parsed,
} from "../lib/parse";

const MAX_LINKS = 500;
const MAX_RECIPIENTS = 1000;
const MAX_SUBJECT = 998; // RFC 5322 line limit

export function parseRegister(body: unknown): Parsed<RegisterMessageRequest> {
	if (!isObject(body)) return fail("body must be an object");
	const { id, provider, subject, recipients, links, mode, groupId } = body;
	if (typeof id !== "string" || !isValidId(id)) return fail("invalid id");
	if (typeof provider !== "string" || !provider || provider.length > 32)
		return fail("invalid provider");
	if (typeof subject !== "string") return fail("invalid subject");
	if (mode !== "shared" && mode !== "individual") return fail("invalid mode");
	if (groupId !== undefined && groupId !== null) {
		if (typeof groupId !== "string" || !isValidId(groupId))
			return fail("invalid groupId");
	}
	if (!Array.isArray(recipients) || recipients.length > MAX_RECIPIENTS)
		return fail("invalid recipients");
	const cleanRecipients: Recipient[] = [];
	for (const r of recipients) {
		if (!isObject(r) || typeof r.email !== "string" || !optString(r.name))
			return fail("invalid recipient");
		cleanRecipients.push(
			typeof r.name === "string" && r.name
				? { email: r.email, name: r.name }
				: { email: r.email },
		);
	}
	if (!Array.isArray(links) || links.length > MAX_LINKS)
		return fail("invalid links");
	for (const l of links) {
		if (typeof l !== "string" || !isHttpUrl(l))
			return fail("links must be http(s) URLs");
	}
	const value: RegisterMessageRequest = {
		id,
		provider,
		subject: subject.slice(0, MAX_SUBJECT),
		recipients: cleanRecipients,
		links: links as string[],
		mode,
		trackOpens: body.trackOpens !== false,
		trackLinks: body.trackLinks !== false,
	};
	if (typeof groupId === "string") value.groupId = groupId;
	return { ok: true, value };
}

export function parseMarkSent(body: unknown): Parsed<MarkSentRequest> {
	if (!isObject(body)) return fail("body must be an object");
	const { sentAt, providerThreadId, providerMessageId } = body;
	if (typeof sentAt !== "number" || !Number.isFinite(sentAt) || sentAt <= 0)
		return fail("invalid sentAt");
	if (!optString(providerThreadId) || !optString(providerMessageId))
		return fail("invalid provider ids");
	const value: MarkSentRequest = { sentAt };
	if (providerThreadId) value.providerThreadId = providerThreadId.slice(0, 256);
	if (providerMessageId)
		value.providerMessageId = providerMessageId.slice(0, 998);
	return { ok: true, value };
}

export function parseOwnerViews(body: unknown): Parsed<OwnerViewRequest> {
	if (!isObject(body) || !Array.isArray(body.messageIds))
		return fail("messageIds required");
	const ids = body.messageIds.filter(
		(v): v is string => typeof v === "string" && isValidId(v),
	);
	return { ok: true, value: { messageIds: [...new Set(ids)].slice(0, 200) } };
}

/** Thread ids from a comma list or JSON array; trimmed, deduped, capped. */
export function cleanThreadIds(values: unknown[]): string[] {
	const out = new Set<string>();
	for (const v of values) {
		if (typeof v !== "string") continue;
		const s = v.trim();
		if (s && s.length <= 256) out.add(s);
		if (out.size >= 200) break;
	}
	return [...out];
}
