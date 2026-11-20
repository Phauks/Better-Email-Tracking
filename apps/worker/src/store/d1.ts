import type {
	EventSource,
	EventType,
	IgnoreReason,
	Recipient,
} from "@bet/shared";
import type {
	ListQuery,
	NewEvent,
	NewMessage,
	PurgeResult,
	SentInfo,
	Store,
	StoredEvent,
	StoredMessage,
} from "./types";

interface MessageRow {
	id: string;
	provider: string;
	subject: string;
	recipients: string;
	mode: string;
	group_id: string | null;
	track_opens: number;
	track_links: number;
	created_at: number;
	sent_at: number | null;
	provider_thread_id: string | null;
	provider_message_id: string | null;
}

interface EventRow {
	id: number;
	message_id: string;
	type: string;
	link_index: number | null;
	at: number;
	source: string;
	location: string | null;
	device: string | null;
	ip_hash: string | null;
	ignored: string | null;
	document_id?: string | null;
	document_name?: string | null;
}

/** D1 caps bound parameters per statement at 100; stay well below. */
const CHUNK = 50;

function chunks<T>(items: T[]): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += CHUNK)
		out.push(items.slice(i, i + CHUNK));
	return out;
}

function placeholders(n: number): string {
	return Array.from({ length: n }, () => "?").join(",");
}

function parseRecipients(raw: string): Recipient[] {
	try {
		const value = JSON.parse(raw);
		return Array.isArray(value) ? value : [];
	} catch {
		return [];
	}
}

function toMessage(row: MessageRow): StoredMessage {
	const msg: StoredMessage = {
		id: row.id,
		provider: row.provider,
		subject: row.subject,
		recipients: parseRecipients(row.recipients),
		mode: row.mode === "individual" ? "individual" : "shared",
		trackOpens: row.track_opens === 1,
		trackLinks: row.track_links === 1,
		createdAt: row.created_at,
	};
	if (row.group_id) msg.groupId = row.group_id;
	if (row.sent_at !== null) msg.sentAt = row.sent_at;
	if (row.provider_thread_id) msg.providerThreadId = row.provider_thread_id;
	if (row.provider_message_id) msg.providerMessageId = row.provider_message_id;
	return msg;
}

function toEvent(row: EventRow): StoredEvent {
	const ev: StoredEvent = {
		id: row.id,
		messageId: row.message_id,
		type: row.type as EventType,
		at: row.at,
		source: row.source as EventSource,
	};
	if (row.link_index !== null) ev.linkIndex = row.link_index;
	if (row.location) ev.location = row.location;
	if (row.device) ev.device = row.device;
	if (row.ip_hash) ev.ipHash = row.ip_hash;
	if (row.ignored) ev.ignored = row.ignored as IgnoreReason;
	if (row.document_id) ev.documentId = row.document_id;
	if (row.document_name) ev.documentName = row.document_name;
	return ev;
}

export class D1Store implements Store {
	constructor(private readonly db: D1Database) {}

	async upsertMessage(msg: NewMessage): Promise<void> {
		const upsert = this.db
			.prepare(
				`INSERT INTO messages (id, provider, subject, recipients, mode, group_id, track_opens, track_links, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
				   provider = excluded.provider, subject = excluded.subject, recipients = excluded.recipients,
				   mode = excluded.mode, group_id = excluded.group_id,
				   track_opens = excluded.track_opens, track_links = excluded.track_links`,
			)
			.bind(
				msg.id,
				msg.provider,
				msg.subject,
				JSON.stringify(msg.recipients),
				msg.mode,
				msg.groupId ?? null,
				msg.trackOpens ? 1 : 0,
				msg.trackLinks ? 1 : 0,
				msg.createdAt,
			);
		const clear = this.db
			.prepare("DELETE FROM links WHERE message_id = ?")
			.bind(msg.id);
		const insertLink = this.db.prepare(
			"INSERT INTO links (message_id, idx, url) VALUES (?, ?, ?)",
		);
		const links = msg.links.map((url, idx) =>
			insertLink.bind(msg.id, idx, url),
		);
		await this.db.batch([upsert, clear, ...links]);
	}

	async markSent(id: string, info: SentInfo): Promise<boolean> {
		const res = await this.db
			.prepare(
				`UPDATE messages SET sent_at = ?,
				   provider_thread_id = COALESCE(?, provider_thread_id),
				   provider_message_id = COALESCE(?, provider_message_id)
				 WHERE id = ?`,
			)
			.bind(
				info.sentAt,
				info.providerThreadId ?? null,
				info.providerMessageId ?? null,
				id,
			)
			.run();
		return res.meta.changes > 0;
	}

	async getMessage(id: string): Promise<StoredMessage | null> {
		const row = await this.db
			.prepare("SELECT * FROM messages WHERE id = ?")
			.bind(id)
			.first<MessageRow>();
		return row ? toMessage(row) : null;
	}

	async getLinks(id: string): Promise<string[]> {
		const { results } = await this.db
			.prepare("SELECT url FROM links WHERE message_id = ? ORDER BY idx")
			.bind(id)
			.all<{ url: string }>();
		return results.map((r) => r.url);
	}

	async getLink(id: string, index: number): Promise<string | null> {
		const row = await this.db
			.prepare("SELECT url FROM links WHERE message_id = ? AND idx = ?")
			.bind(id, index)
			.first<{ url: string }>();
		return row?.url ?? null;
	}

	async listMessages(query: ListQuery): Promise<StoredMessage[]> {
		const where: string[] = [];
		const args: unknown[] = [];
		if (query.before !== undefined) {
			where.push("created_at < ?");
			args.push(query.before);
		}
		if (query.groupId) {
			where.push("group_id = ?");
			args.push(query.groupId);
		}
		if (query.q) {
			const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
			where.push(
				"(subject LIKE ? ESCAPE '\\' OR recipients LIKE ? ESCAPE '\\')",
			);
			args.push(like, like);
		}
		const sql = `SELECT * FROM messages ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
		const { results } = await this.db
			.prepare(sql)
			.bind(...args, query.limit)
			.all<MessageRow>();
		return results.map(toMessage);
	}

	getMessagesByIds(ids: string[]): Promise<StoredMessage[]> {
		return this.messagesWhereIn("id", ids);
	}

	getMessagesByThreadIds(threadIds: string[]): Promise<StoredMessage[]> {
		return this.messagesWhereIn("provider_thread_id", threadIds);
	}

	getMessagesByGroupIds(groupIds: string[]): Promise<StoredMessage[]> {
		return this.messagesWhereIn("group_id", groupIds);
	}

	async deleteMessage(id: string): Promise<boolean> {
		const results = await this.db.batch([
			this.db.prepare("DELETE FROM events WHERE message_id = ?").bind(id),
			this.db.prepare("DELETE FROM links WHERE message_id = ?").bind(id),
			this.db.prepare("DELETE FROM owner_views WHERE message_id = ?").bind(id),
			this.db.prepare("DELETE FROM messages WHERE id = ?").bind(id),
		]);
		return (results[3]?.meta.changes ?? 0) > 0;
	}

	async insertEvent(e: NewEvent): Promise<number> {
		const row = await this.db
			.prepare(
				`INSERT INTO events (message_id, type, link_index, at, source, location, device, ip_hash, ignored, document_id, document_name)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
			)
			.bind(
				e.messageId,
				e.type,
				e.linkIndex ?? null,
				e.at,
				e.source,
				e.location ?? null,
				e.device ?? null,
				e.ipHash ?? null,
				e.ignored ?? null,
				e.documentId ?? null,
				e.documentName ?? null,
			)
			.first<{ id: number }>();
		return row?.id ?? 0;
	}

	async getEventsForMessages(ids: string[]): Promise<StoredEvent[]> {
		const out: StoredEvent[] = [];
		for (const part of chunks([...new Set(ids)])) {
			const { results } = await this.db
				.prepare(
					`SELECT * FROM events WHERE message_id IN (${placeholders(part.length)}) ORDER BY id`,
				)
				.bind(...part)
				.all<EventRow>();
			out.push(...results.map(toEvent));
		}
		return out.sort((a, b) => a.id - b.id);
	}

	async getFeedEventsAfter(
		since: number,
		limit: number,
	): Promise<StoredEvent[]> {
		const { results } = await this.db
			.prepare(
				"SELECT * FROM events WHERE ignored IS NULL AND id > ? ORDER BY id LIMIT ?",
			)
			.bind(since, limit)
			.all<EventRow>();
		return results.map(toEvent);
	}

	async getLatestFeedEvents(limit: number): Promise<StoredEvent[]> {
		const { results } = await this.db
			.prepare(
				"SELECT * FROM events WHERE ignored IS NULL ORDER BY id DESC LIMIT ?",
			)
			.bind(limit)
			.all<EventRow>();
		return results.map(toEvent).reverse();
	}

	async ignoreOpensSince(
		messageIds: string[],
		since: number,
		reason: IgnoreReason,
	): Promise<number> {
		if (messageIds.length === 0) return 0;
		const stmt = this.db.prepare(
			"UPDATE events SET ignored = ? WHERE message_id = ? AND type = 'open' AND ignored IS NULL AND at >= ?",
		);
		const results = await this.db.batch(
			messageIds.map((id) => stmt.bind(reason, id, since)),
		);
		return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
	}

	async recordOwnerViews(
		messageIds: string[],
		at: number,
		ipHash?: string,
	): Promise<void> {
		if (messageIds.length === 0) return;
		const stmt = this.db.prepare(
			"INSERT INTO owner_views (message_id, at, ip_hash) VALUES (?, ?, ?)",
		);
		await this.db.batch(
			messageIds.map((id) => stmt.bind(id, at, ipHash ?? null)),
		);
	}

	async lastOwnerViewAt(messageId: string): Promise<number | null> {
		const row = await this.db
			.prepare("SELECT MAX(at) AS at FROM owner_views WHERE message_id = ?")
			.bind(messageId)
			.first<{ at: number | null }>();
		return row?.at ?? null;
	}

	async ownerIpSeenSince(ipHash: string, since: number): Promise<boolean> {
		const row = await this.db
			.prepare(
				"SELECT 1 AS hit FROM owner_views WHERE ip_hash = ? AND at >= ? LIMIT 1",
			)
			.bind(ipHash, since)
			.first<{ hit: number }>();
		return row !== null;
	}

	async purgeBefore(cutoff: number): Promise<PurgeResult> {
		const old =
			"SELECT id FROM messages WHERE COALESCE(sent_at, created_at) < ?1";
		const results = await this.db.batch([
			this.db
				.prepare(`DELETE FROM events WHERE at < ?1 OR message_id IN (${old})`)
				.bind(cutoff),
			this.db
				.prepare(
					`DELETE FROM owner_views WHERE at < ?1 OR message_id IN (${old})`,
				)
				.bind(cutoff),
			this.db
				.prepare(`DELETE FROM links WHERE message_id IN (${old})`)
				.bind(cutoff),
			this.db
				.prepare(
					"DELETE FROM messages WHERE COALESCE(sent_at, created_at) < ?1",
				)
				.bind(cutoff),
		]);
		return {
			events: results[0]?.meta.changes ?? 0,
			ownerViews: results[1]?.meta.changes ?? 0,
			messages: results[3]?.meta.changes ?? 0,
		};
	}

	private async messagesWhereIn(
		column: "id" | "provider_thread_id" | "group_id",
		values: string[],
	): Promise<StoredMessage[]> {
		const out: StoredMessage[] = [];
		for (const part of chunks([...new Set(values)])) {
			const { results } = await this.db
				.prepare(
					`SELECT * FROM messages WHERE ${column} IN (${placeholders(part.length)})`,
				)
				.bind(...part)
				.all<MessageRow>();
			out.push(...results.map(toMessage));
		}
		return out;
	}
}
