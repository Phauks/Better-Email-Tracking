import type { DocumentEventType, EventSource, IgnoreReason } from "@bet/shared";

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
	/** Newest first. */
	listDocuments(limit: number): Promise<StoredDocument[]>;
	/** Sets the page count if it is not known yet. */
	setPageCount(id: string, pages: number): Promise<void>;
	/**
	 * Deletes the document row, its events, its message links and its doc_view rows
	 * in the core events table. Returns the deleted document, or null.
	 */
	deleteDocument(id: string): Promise<StoredDocument | null>;

	insertEvent(event: NewDocEvent): Promise<number>;
	getEvent(id: number): Promise<StoredDocEvent | null>;
	/** All events (ignored included), ascending by id. */
	getEventsForDocuments(ids: string[]): Promise<StoredDocEvent[]>;

	attachToMessage(messageId: string, documentIds: string[]): Promise<void>;
	getMessageLinks(documentIds: string[]): Promise<DocumentMessageLink[]>;

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
