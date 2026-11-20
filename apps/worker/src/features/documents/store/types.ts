import type {
	DocumentEventType,
	DocumentPageStats,
	DocumentStats,
	EventSource,
	IgnoreReason,
} from "@bet/shared";

/** An uploaded document. The bytes live in the object store under r2Key. */
export interface StoredDocument {
	id: string;
	name: string;
	mime: string;
	size: number;
	r2Key: string;
	pages?: number;
	createdAt: number;
}

export interface StoredDocEvent {
	id: number;
	documentId: string;
	messageId?: string;
	/** The 'view' event a page/download event belongs to. */
	viewId?: number;
	type: DocumentEventType;
	page?: number;
	dwellMs?: number;
	at: number;
	source: EventSource;
	location?: string;
	device?: string;
	ipHash?: string;
	ignored?: IgnoreReason;
}

export type NewDocEvent = Omit<StoredDocEvent, "id">;

export interface DocumentMessageLink {
	documentId: string;
	messageId: string;
}

/** One tracked message's counted engagement with a document (null = unattributed link). */
export interface DocRecipientRow {
	messageId: string | null;
	views: number;
	downloads: number;
	dwellMs: number;
	lastViewedAt?: number;
	/** The message's sentAt, for ordering. */
	sentAt?: number;
}

/**
 * Order of per-recipient rows: most recently viewed first, then most recently sent,
 * then message id (unviewed or unsent count as 0, the unattributed row as "").
 */
export type DocRecipientKey = [
	lastViewedAt: number,
	sentAt: number,
	key: string,
];

export function docRecipientKey(r: DocRecipientRow): DocRecipientKey {
	return [r.lastViewedAt ?? 0, r.sentAt ?? 0, r.messageId ?? ""];
}

export interface DocRecipientQuery {
	/** Rows to return (routes ask for one more to detect a next page). */
	limit: number;
	/** Keyset: rows strictly after this key in the order above. */
	after?: DocRecipientKey;
}

export interface DocumentListQuery {
	limit: number;
	/** Keyset: strictly after this (createdAt, id) in newest-first order. */
	after?: { createdAt: number; id: string };
}

export interface DocumentPurgeResult {
	/** Purged documents, so the caller can delete their objects. */
	documents: StoredDocument[];
	events: number;
}

/**
 * Persistence for documents, separate from the core Store so the feature stays
 * self-contained. D1DocumentStore in production, MemoryDocumentStore in tests.
 */
export interface DocumentStore {
	createDocument(doc: StoredDocument): Promise<void>;
	getDocument(id: string): Promise<StoredDocument | null>;
	/** Newest first by (createdAt, id). */
	listDocuments(query: DocumentListQuery): Promise<StoredDocument[]>;
	/** Sets the page count if it is not known yet. */
	setPageCount(id: string, pages: number): Promise<void>;
	/**
	 * Deletes the document row, its events, its message links and its doc_view rows
	 * in the core events table. Returns the deleted document, or null.
	 */
	deleteDocument(id: string): Promise<StoredDocument | null>;

	insertEvent(event: NewDocEvent): Promise<number>;
	getEvent(id: number): Promise<StoredDocEvent | null>;
	/** All events (ignored included), ascending by id. Small sets only (tests, tools). */
	getEventsForDocuments(ids: string[]): Promise<StoredDocEvent[]>;

	/** Counted stats per document (SQL aggregate); every id gets an entry. */
	statsForDocuments(ids: string[]): Promise<Map<string, DocumentStats>>;
	/**
	 * One row per message the document went out in (viewed or not) and per message
	 * with counted views, plus the unattributed row; ordered and paged by key.
	 */
	recipientRows(
		documentId: string,
		query: DocRecipientQuery,
	): Promise<DocRecipientRow[]>;
	/** Per-page dwell and distinct views, by page. */
	pageStats(documentId: string): Promise<DocumentPageStats[]>;
	/** The newest events (ignored included), newest first. */
	recentEvents(documentId: string, limit: number): Promise<StoredDocEvent[]>;

	attachToMessage(messageId: string, documentIds: string[]): Promise<void>;

	/** Removes events older than cutoff and documents created before it (with their data). */
	purgeBefore(cutoff: number): Promise<DocumentPurgeResult>;
}

export interface StoredObject {
	body: ReadableStream | ArrayBuffer;
	size: number;
}

/** Where file bytes live. R2 in production; a Map in tests. */
export interface ObjectStore {
	put(key: string, data: ArrayBuffer, contentType: string): Promise<void>;
	get(key: string): Promise<StoredObject | null>;
	delete(keys: string[]): Promise<void>;
}
