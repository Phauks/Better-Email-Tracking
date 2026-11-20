import type { MemoryStore } from "../store/memory";
import type {
	DocumentMessageLink,
	DocumentPurgeResult,
	DocumentStore,
	NewDocEvent,
	StoredDocEvent,
	StoredDocument,
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

/** In-memory DocumentStore for tests. Pass the core MemoryStore to mirror deletes. */
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

	async listDocuments(limit: number) {
		return [...this.documents.values()]
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, limit)
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

	async getMessageLinks(documentIds: string[]) {
		const set = new Set(documentIds);
		return this.links.filter((l) => set.has(l.documentId));
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
}
