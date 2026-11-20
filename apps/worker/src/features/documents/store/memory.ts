import type { MemoryStore } from "../../../core/store/memory";
import { compareKeys, documentStats, pageStats, recipientRows } from "../stats";
import {
	type DocRecipientQuery,
	type DocumentListQuery,
	type DocumentMessageLink,
	type DocumentPurgeResult,
	type DocumentStore,
	docRecipientKey,
	type NewDocEvent,
	type StoredDocEvent,
	type StoredDocument,
} from "./types";

function removeWhere<T>(list: T[], pred: (item: T) => boolean): number {
	let removed = 0;
	for (let i = list.length - 1; i >= 0; i--) {
		if (pred(list[i] as T)) {
			list.splice(i, 1);
			removed++;
		}
	}
	return removed;
}

/**
 * In-memory DocumentStore for tests, computing stats with the reference functions in
 * stats.ts. Pass the core MemoryStore to mirror deletes and to order recipients by
 * their message's sentAt.
 */
export class MemoryDocumentStore implements DocumentStore {
	readonly documents = new Map<string, StoredDocument>();
	readonly events: StoredDocEvent[] = [];
	readonly links: DocumentMessageLink[] = [];
	private nextId = 1;

	constructor(private readonly core?: MemoryStore) {}

	async createDocument(doc: StoredDocument) {
		this.documents.set(doc.id, { ...doc });
	}

	async getDocument(id: string) {
		const d = this.documents.get(id);
		return d ? { ...d } : null;
	}

	async listDocuments(query: DocumentListQuery) {
		const after = query.after;
		return [...this.documents.values()]
			.filter(
				(d) =>
					!after ||
					d.createdAt < after.createdAt ||
					(d.createdAt === after.createdAt && d.id < after.id),
			)
			.sort(
				(a, b) =>
					b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
			)
			.slice(0, query.limit)
			.map((d) => ({ ...d }));
	}

	async setPageCount(id: string, pages: number) {
		const d = this.documents.get(id);
		if (d && d.pages === undefined) d.pages = pages;
	}

	async deleteDocument(id: string) {
		const d = this.documents.get(id);
		if (!d) return null;
		this.documents.delete(id);
		removeWhere(this.events, (e) => e.documentId === id);
		removeWhere(this.links, (l) => l.documentId === id);
		if (this.core) removeWhere(this.core.events, (e) => e.documentId === id);
		return d;
	}

	async insertEvent(event: NewDocEvent) {
		const id = this.nextId++;
		this.events.push({ ...event, id });
		return id;
	}

	async getEvent(id: number) {
		const e = this.events.find((x) => x.id === id);
		return e ? { ...e } : null;
	}

	async getEventsForDocuments(ids: string[]) {
		const set = new Set(ids);
		return this.events.filter((e) => set.has(e.documentId));
	}

	async statsForDocuments(ids: string[]) {
		return new Map(
			ids.map((id) => [id, documentStats(this.eventsOf(id))] as const),
		);
	}

	async recipientRows(documentId: string, query: DocRecipientQuery) {
		const linked = this.links
			.filter((l) => l.documentId === documentId)
			.map((l) => l.messageId);
		const rows = recipientRows(
			this.eventsOf(documentId),
			linked,
			(id) => this.core?.messages.get(id)?.sentAt,
		);
		const after = query.after;
		return rows
			.filter((r) => !after || compareKeys(docRecipientKey(r), after) > 0)
			.slice(0, query.limit);
	}

	async pageStats(documentId: string) {
		return pageStats(this.eventsOf(documentId));
	}

	async recentEvents(documentId: string, limit: number) {
		return this.eventsOf(documentId)
			.slice(-limit)
			.reverse()
			.map((e) => ({ ...e }));
	}

	async attachToMessage(messageId: string, documentIds: string[]) {
		for (const documentId of documentIds) {
			if (
				!this.links.some(
					(l) => l.documentId === documentId && l.messageId === messageId,
				)
			)
				this.links.push({ documentId, messageId });
		}
	}

	async purgeBefore(cutoff: number): Promise<DocumentPurgeResult> {
		const old = [...this.documents.values()].filter(
			(d) => d.createdAt < cutoff,
		);
		const oldIds = new Set(old.map((d) => d.id));
		for (const d of old) this.documents.delete(d.id);
		removeWhere(this.links, (l) => oldIds.has(l.documentId));
		const events = removeWhere(
			this.events,
			(e) => e.at < cutoff || oldIds.has(e.documentId),
		);
		return { documents: old, events };
	}

	private eventsOf(documentId: string): StoredDocEvent[] {
		return this.events
			.filter((e) => e.documentId === documentId)
			.sort((a, b) => a.id - b.id);
	}
}
