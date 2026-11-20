import type {
	DocumentEventType,
	DocumentPageStats,
	DocumentStats,
	EventSource,
	IgnoreReason,
} from "@bet/shared";
import { chunks, placeholders } from "../../../lib/d1";
import { MAX_PAGES } from "../validate";
import type {
	DocRecipientQuery,
	DocRecipientRow,
	DocumentListQuery,
	DocumentPurgeResult,
	DocumentStore,
	NewDocEvent,
	StoredDocEvent,
	StoredDocument,
} from "./types";

/** isCountedDocEvent in SQL. */
const COUNTED = "ignored IS NULL AND source <> 'scanner'";

interface DocumentRow {
	id: string;
	name: string;
	mime: string;
	size: number;
	r2_key: string;
	pages: number | null;
	created_at: number;
}

interface DocEventRow {
	id: number;
	document_id: string;
	message_id: string | null;
	view_id: number | null;
	type: string;
	page: number | null;
	dwell_ms: number | null;
	at: number;
	source: string;
	location: string | null;
	device: string | null;
	ip_hash: string | null;
	ignored: string | null;
}

function toDocument(row: DocumentRow): StoredDocument {
	const d: StoredDocument = {
		id: row.id,
		name: row.name,
		mime: row.mime,
		size: row.size,
		r2Key: row.r2_key,
		createdAt: row.created_at,
	};
	if (row.pages !== null) d.pages = row.pages;
	return d;
}

function toEvent(row: DocEventRow): StoredDocEvent {
	const e: StoredDocEvent = {
		id: row.id,
		documentId: row.document_id,
		type: row.type as DocumentEventType,
		at: row.at,
		source: row.source as EventSource,
	};
	if (row.message_id) e.messageId = row.message_id;
	if (row.view_id !== null) e.viewId = row.view_id;
	if (row.page !== null) e.page = row.page;
	if (row.dwell_ms !== null) e.dwellMs = row.dwell_ms;
	if (row.location) e.location = row.location;
	if (row.device) e.device = row.device;
	if (row.ip_hash) e.ipHash = row.ip_hash;
	if (row.ignored) e.ignored = row.ignored as IgnoreReason;
	return e;
}

export class D1DocumentStore implements DocumentStore {
	constructor(private readonly db: D1Database) {}

	async createDocument(d: StoredDocument) {
		await this.db
			.prepare(
				"INSERT INTO documents (id, name, mime, size, r2_key, pages, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			)
			.bind(d.id, d.name, d.mime, d.size, d.r2Key, d.pages ?? null, d.createdAt)
			.run();
	}

	async getDocument(id: string) {
		const row = await this.db
			.prepare("SELECT * FROM documents WHERE id = ?")
			.bind(id)
			.first<DocumentRow>();
		return row ? toDocument(row) : null;
	}

	async listDocuments(query: DocumentListQuery) {
		const stmt = query.after
			? this.db
					.prepare(
						`SELECT * FROM documents WHERE (created_at, id) < (?, ?)
						 ORDER BY created_at DESC, id DESC LIMIT ?`,
					)
					.bind(query.after.createdAt, query.after.id, query.limit)
			: this.db
					.prepare(
						"SELECT * FROM documents ORDER BY created_at DESC, id DESC LIMIT ?",
					)
					.bind(query.limit);
		const { results } = await stmt.all<DocumentRow>();
		return results.map(toDocument);
	}

	async setPageCount(id: string, pages: number) {
		await this.db
			.prepare("UPDATE documents SET pages = ? WHERE id = ? AND pages IS NULL")
			.bind(pages, id)
			.run();
	}

	async deleteDocument(id: string) {
		const doc = await this.getDocument(id);
		if (!doc) return null;
		await this.db.batch([
			this.db
				.prepare("DELETE FROM document_events WHERE document_id = ?")
				.bind(id),
			this.db
				.prepare("DELETE FROM document_messages WHERE document_id = ?")
				.bind(id),
			this.db.prepare("DELETE FROM events WHERE document_id = ?").bind(id),
			this.db.prepare("DELETE FROM documents WHERE id = ?").bind(id),
		]);
		return doc;
	}

	async insertEvent(e: NewDocEvent) {
		const row = await this.db
			.prepare(
				`INSERT INTO document_events (document_id, message_id, view_id, type, page, dwell_ms, at, source, location, device, ip_hash, ignored)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
			)
			.bind(
				e.documentId,
				e.messageId ?? null,
				e.viewId ?? null,
				e.type,
				e.page ?? null,
				e.dwellMs ?? null,
				e.at,
				e.source,
				e.location ?? null,
				e.device ?? null,
				e.ipHash ?? null,
				e.ignored ?? null,
			)
			.first<{ id: number }>();
		return row?.id ?? 0;
	}

	async getEvent(id: number) {
		const row = await this.db
			.prepare("SELECT * FROM document_events WHERE id = ?")
			.bind(id)
			.first<DocEventRow>();
		return row ? toEvent(row) : null;
	}

	async getEventsForDocuments(ids: string[]) {
		const out: StoredDocEvent[] = [];
		for (const part of chunks([...new Set(ids)])) {
			const { results } = await this.db
				.prepare(
					`SELECT * FROM document_events WHERE document_id IN (${placeholders(part.length)}) ORDER BY id`,
				)
				.bind(...part)
				.all<DocEventRow>();
			out.push(...results.map(toEvent));
		}
		return out.sort((a, b) => a.id - b.id);
	}

	async statsForDocuments(ids: string[]) {
		const out = new Map<string, DocumentStats>();
		for (const id of ids)
			out.set(id, {
				views: 0,
				uniqueViewers: 0,
				downloads: 0,
				totalDwellMs: 0,
			});
		for (const part of chunks([...new Set(ids)])) {
			const { results } = await this.db
				.prepare(
					`SELECT document_id,
					   COALESCE(SUM(type = 'view'), 0) AS views,
					   COUNT(DISTINCT CASE WHEN type = 'view'
					     THEN COALESCE('m:' || message_id, 'ip:' || ip_hash, 'v:' || id) END) AS unique_viewers,
					   COALESCE(SUM(type = 'download'), 0) AS downloads,
					   COALESCE(SUM(CASE WHEN type = 'page' THEN COALESCE(dwell_ms, 0) END), 0) AS dwell,
					   MAX(CASE WHEN type = 'view' THEN at END) AS last_viewed
					 FROM document_events
					 WHERE document_id IN (${placeholders(part.length)}) AND ${COUNTED}
					 GROUP BY document_id`,
				)
				.bind(...part)
				.all<{
					document_id: string;
					views: number;
					unique_viewers: number;
					downloads: number;
					dwell: number;
					last_viewed: number | null;
				}>();
			for (const r of results) {
				const stats: DocumentStats = {
					views: r.views,
					uniqueViewers: r.unique_viewers,
					downloads: r.downloads,
					totalDwellMs: r.dwell,
				};
				if (r.last_viewed !== null) stats.lastViewedAt = r.last_viewed;
				out.set(r.document_id, stats);
			}
		}
		return out;
	}

	async recipientRows(documentId: string, query: DocRecipientQuery) {
		const after = query.after;
		const { results } = await this.db
			.prepare(
				`WITH agg AS (
				   SELECT message_id,
				     SUM(type = 'view') AS views,
				     SUM(type = 'download') AS downloads,
				     SUM(CASE WHEN type = 'page' THEN COALESCE(dwell_ms, 0) ELSE 0 END) AS dwell,
				     MAX(CASE WHEN type = 'view' THEN at END) AS last_viewed
				   FROM document_events WHERE document_id = ?1 AND ${COUNTED}
				   GROUP BY message_id
				 ), keyed AS (
				   SELECT message_id FROM document_messages WHERE document_id = ?1
				   UNION SELECT message_id FROM agg
				 ), ranked AS (
				   SELECT k.message_id AS message_id,
				     COALESCE(a.views, 0) AS views, COALESCE(a.downloads, 0) AS downloads,
				     COALESCE(a.dwell, 0) AS dwell, a.last_viewed AS last_viewed, m.sent_at AS sent_at,
				     COALESCE(a.last_viewed, 0) AS k1, COALESCE(m.sent_at, 0) AS k2,
				     COALESCE(k.message_id, '') AS k3
				   FROM keyed k
				   LEFT JOIN agg a ON a.message_id IS k.message_id
				   LEFT JOIN messages m ON m.id = k.message_id
				 )
				 SELECT * FROM ranked ${after ? "WHERE (k1, k2, k3) < (?2, ?3, ?4)" : ""}
				 ORDER BY k1 DESC, k2 DESC, k3 DESC LIMIT ${after ? "?5" : "?2"}`,
			)
			.bind(
				documentId,
				...(after ? [after[0], after[1], after[2]] : []),
				query.limit,
			)
			.all<{
				message_id: string | null;
				views: number;
				downloads: number;
				dwell: number;
				last_viewed: number | null;
				sent_at: number | null;
			}>();
		return results.map((r) => {
			const row: DocRecipientRow = {
				messageId: r.message_id,
				views: r.views,
				downloads: r.downloads,
				dwellMs: r.dwell,
			};
			if (r.last_viewed !== null) row.lastViewedAt = r.last_viewed;
			if (r.sent_at !== null) row.sentAt = r.sent_at;
			return row;
		});
	}

	async pageStats(documentId: string): Promise<DocumentPageStats[]> {
		const { results } = await this.db
			.prepare(
				`SELECT page, COALESCE(SUM(dwell_ms), 0) AS dwell,
				   COUNT(DISTINCT COALESCE(CAST(view_id AS TEXT), 'e' || id)) AS views
				 FROM document_events
				 WHERE document_id = ? AND type = 'page' AND page IS NOT NULL AND ${COUNTED}
				 GROUP BY page ORDER BY page LIMIT ?`,
			)
			.bind(documentId, MAX_PAGES)
			.all<{ page: number; dwell: number; views: number }>();
		return results.map((r) => ({
			page: r.page,
			dwellMs: r.dwell,
			views: r.views,
		}));
	}

	async recentEvents(documentId: string, limit: number) {
		const { results } = await this.db
			.prepare(
				"SELECT * FROM document_events WHERE document_id = ? ORDER BY id DESC LIMIT ?",
			)
			.bind(documentId, limit)
			.all<DocEventRow>();
		return results.map(toEvent);
	}

	async attachToMessage(messageId: string, documentIds: string[]) {
		if (documentIds.length === 0) return;
		const stmt = this.db.prepare(
			"INSERT OR IGNORE INTO document_messages (document_id, message_id) VALUES (?, ?)",
		);
		await this.db.batch(documentIds.map((d) => stmt.bind(d, messageId)));
	}

	async purgeBefore(cutoff: number): Promise<DocumentPurgeResult> {
		const { results } = await this.db
			.prepare("SELECT * FROM documents WHERE created_at < ?")
			.bind(cutoff)
			.all<DocumentRow>();
		const old = "SELECT id FROM documents WHERE created_at < ?1";
		const res = await this.db.batch([
			this.db
				.prepare(
					`DELETE FROM document_events WHERE at < ?1 OR document_id IN (${old})`,
				)
				.bind(cutoff),
			this.db
				.prepare(`DELETE FROM document_messages WHERE document_id IN (${old})`)
				.bind(cutoff),
			this.db
				.prepare(`DELETE FROM events WHERE document_id IN (${old})`)
				.bind(cutoff),
			this.db
				.prepare("DELETE FROM documents WHERE created_at < ?1")
				.bind(cutoff),
		]);
		return {
			documents: results.map(toDocument),
			events: res[0]?.meta.changes ?? 0,
		};
	}
}
