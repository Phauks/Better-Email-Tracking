import type { DocumentEventType, EventSource, IgnoreReason } from "@bet/shared";
import { chunks, placeholders } from "../../../lib/d1";
import type {
	DocumentMessageLink,
	DocumentPurgeResult,
	DocumentStore,
	NewDocEvent,
	StoredDocEvent,
	StoredDocument,
} from "./types";

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

	async listDocuments(limit: number) {
		const { results } = await this.db
			.prepare("SELECT * FROM documents ORDER BY created_at DESC LIMIT ?")
			.bind(limit)
			.all<DocumentRow>();
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

	async attachToMessage(messageId: string, documentIds: string[]) {
		if (documentIds.length === 0) return;
		const stmt = this.db.prepare(
			"INSERT OR IGNORE INTO document_messages (document_id, message_id) VALUES (?, ?)",
		);
		await this.db.batch(documentIds.map((d) => stmt.bind(d, messageId)));
	}

	async getMessageLinks(documentIds: string[]) {
		const out: DocumentMessageLink[] = [];
		for (const part of chunks([...new Set(documentIds)])) {
			const { results } = await this.db
				.prepare(
					`SELECT document_id, message_id FROM document_messages WHERE document_id IN (${placeholders(part.length)})`,
				)
				.bind(...part)
				.all<{ document_id: string; message_id: string }>();
			for (const r of results)
				out.push({ documentId: r.document_id, messageId: r.message_id });
		}
		return out;
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
