import { type FetchLike, gmailFetch } from "./google-oauth";
import { buildReplyMime, toGmailRaw } from "./mime";
import {
	type MailboxConnector,
	NUDGE_MARKER_HEADER,
	type OutgoingReply,
	type SentReply,
	type ThreadInspection,
	type ThreadRef,
} from "./types";

interface GmailHeader {
	name: string;
	value: string;
}

export interface GmailThreadMessage {
	id: string;
	threadId?: string;
	labelIds?: string[];
	internalDate?: string;
	payload?: { headers?: GmailHeader[] };
}

export interface GmailThread {
	id: string;
	messages?: GmailThreadMessage[];
}

const METADATA_HEADERS = [
	"From",
	"Date",
	"Message-ID",
	"References",
	"Auto-Submitted",
	NUDGE_MARKER_HEADER,
];

/** Bare lowercase address from a From header ("Ann <ann@x.com>" → "ann@x.com"). */
export function addressOf(from: string): string {
	const m = /<([^>]+)>/.exec(from);
	return (m?.[1] ?? from).trim().toLowerCase();
}

function header(msg: GmailThreadMessage, name: string): string | undefined {
	const lower = name.toLowerCase();
	return msg.payload?.headers?.find((h) => h.name.toLowerCase() === lower)
		?.value;
}

const BOUNCE_FROM = /^(mailer-daemon|postmaster)@/i;

/**
 * Reads a thread (metadata only) and decides whether anyone but the owner answered
 * after `since`. Pure, so it is unit-tested without the network.
 * - Own messages are those labelled SENT or sent from the owner's address (covers aliases).
 * - Drafts are skipped.
 * - Bounces stop the sequence; other automatic replies (Auto-Submitted, e.g. out of
 *   office) don't count as replies.
 */
export function inspectGmailThread(
	thread: GmailThread,
	since: number,
	ownerAddress: string,
): ThreadInspection {
	const owner = ownerAddress.toLowerCase();
	const messages = [...(thread.messages ?? [])]
		.filter((m) => !m.labelIds?.includes("DRAFT"))
		.sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
	const out: ThreadInspection = {
		reply: null,
		bounced: false,
		sentMarkers: [],
		threading: { references: [] },
	};
	for (const m of messages) {
		const marker = header(m, NUDGE_MARKER_HEADER);
		if (marker) out.sentMarkers.push(marker.trim());
		const at = Number(m.internalDate ?? 0);
		const from = addressOf(header(m, "From") ?? "");
		const own = m.labelIds?.includes("SENT") || from === owner;
		if (own || at <= since) continue;
		if (BOUNCE_FROM.test(from)) {
			out.bounced = true;
			continue;
		}
		const auto = (header(m, "Auto-Submitted") ?? "no").trim().toLowerCase();
		if (auto !== "no") continue;
		out.reply ??= { at, from };
	}
	const last = messages.at(-1);
	if (last) {
		const id = header(last, "Message-ID");
		const refs = (header(last, "References") ?? "")
			.split(/\s+/)
			.filter(Boolean);
		if (id) out.threading.inReplyTo = id.trim();
		out.threading.references = refs;
	}
	return out;
}

/** Gmail API implementation of MailboxConnector. */
export class GmailConnector implements MailboxConnector {
	readonly kind = "google";

	constructor(
		readonly ownerAddress: string,
		private readonly accessToken: () => Promise<string>,
		private readonly fetchImpl: FetchLike,
	) {}

	async findReplies(
		thread: ThreadRef,
		since: number,
		ownerAddress: string,
	): Promise<ThreadInspection> {
		const qs = new URLSearchParams({ format: "metadata" });
		for (const h of METADATA_HEADERS) qs.append("metadataHeaders", h);
		const data = await gmailFetch<GmailThread>(
			this.fetchImpl,
			await this.accessToken(),
			`/threads/${encodeURIComponent(thread.threadId)}?${qs}`,
		);
		return inspectGmailThread(data, since, ownerAddress);
	}

	async sendReply(thread: ThreadRef, reply: OutgoingReply): Promise<SentReply> {
		const raw = toGmailRaw(buildReplyMime(reply));
		const res = await gmailFetch<{ id: string; threadId: string }>(
			this.fetchImpl,
			await this.accessToken(),
			"/messages/send",
			{ method: "POST", body: { raw, threadId: thread.threadId } },
		);
		return { providerMessageId: res.id, providerThreadId: res.threadId };
	}
}
