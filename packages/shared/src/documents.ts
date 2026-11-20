import type { IgnoreReason, Recipient } from "./api";
import type { EventSource } from "./classify";
import type { Paged } from "./pagination";

/**
 * Tracked documents: the owner uploads a file to the Worker and links to it from an
 * email. Each tracked message gets its own link (`/d/<docId>/<messageId>`), so a
 * view tells you which recipient (or individual-send copy) opened the document.
 */

/** Default upload cap; the Worker's DOCS_MAX_MB overrides it. */
export const DEFAULT_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export type DocumentEventType = "view" | "page" | "download";

export interface UploadDocumentResponse {
	id: string;
	name: string;
	mime: string;
	size: number;
	/** Shareable link to put in an email; instrumentation makes it per-message at send. */
	url: string;
}

export interface DocumentStats {
	/** Counted views (owner, send-grace and scanner views excluded). */
	views: number;
	/** Distinct viewers: by tracked message, else by hashed IP for unattributed views. */
	uniqueViewers: number;
	downloads: number;
	/** Sum of per-page dwell time across counted views. */
	totalDwellMs: number;
	lastViewedAt?: number;
}

export interface DocumentSummary {
	id: string;
	name: string;
	mime: string;
	size: number;
	/** Known once a viewer has rendered the PDF. */
	pageCount?: number;
	createdAt: number;
	url: string;
	stats: DocumentStats;
}

/** One tracked message the document went out in, or the unattributed bucket (messageId null). */
export interface DocumentRecipientStats {
	messageId: string | null;
	recipients: Recipient[];
	subject?: string;
	sentAt?: number;
	views: number;
	downloads: number;
	dwellMs: number;
	lastViewedAt?: number;
}

export interface DocumentPageStats {
	page: number;
	/** Total counted dwell on this page. */
	dwellMs: number;
	/** Number of distinct views that spent time on this page. */
	views: number;
}

export interface DocumentEvent {
	id: number;
	type: DocumentEventType;
	messageId?: string;
	page?: number;
	dwellMs?: number;
	at: number;
	source: EventSource;
	device?: string;
	location?: string;
	ignored?: IgnoreReason;
}

/**
 * Detail with the first page of per-recipient rows (most recently viewed first, then
 * most recently sent). More with GET /api/documents/:id/recipients.
 */
export interface DocumentDetail extends DocumentSummary {
	recipients: DocumentRecipientStats[];
	recipientsNextCursor?: string;
	pages: DocumentPageStats[];
	/** Newest first, capped. */
	events: DocumentEvent[];
}

export interface ListDocumentsResponse extends Paged {
	documents: DocumentSummary[];
}

export interface ListDocumentRecipientsResponse extends Paged {
	recipients: DocumentRecipientStats[];
}

/** Links a registered message to the documents its body links to. */
export interface AttachDocumentsRequest {
	messageId: string;
	documentIds: string[];
}

/** Sent by the public viewer page (unauthenticated, size-capped). */
export interface ViewerEventsRequest {
	/** Id returned by the initial view report; later events inherit its classification. */
	viewId?: number;
	/** Page count reported by the PDF viewer with the first view. */
	pageCount?: number;
	events: { type: DocumentEventType; page?: number; dwellMs?: number }[];
}

export interface ViewerEventsResponse {
	viewId?: number;
}

export const DOCUMENT_API = {
	documents: "/api/documents",
	document: (id: string) => `/api/documents/${id}`,
	recipients: (id: string) => `/api/documents/${id}/recipients`,
	/** Owner preview: authenticated, never counted as a view. */
	file: (id: string) => `/api/documents/${id}/file`,
	attach: "/api/documents/attach",
} as const;

export interface DocumentLink {
	documentId: string;
	messageId?: string;
}

const ID = "[0-9A-Za-z]{16,32}";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Parses `${base}/d/<docId>` or `${base}/d/<docId>/<messageId>`; null for anything else. */
export function parseDocumentLink(
	url: string,
	trackerBase: string,
): DocumentLink | null {
	const base = trackerBase.replace(/\/+$/, "");
	if (!base) return null;
	const re = new RegExp(
		`^${escapeRe(base)}/d/(${ID})(?:/(${ID}))?/?(?:[?#].*)?$`,
		"i",
	);
	const m = re.exec(url.trim());
	if (!m?.[1]) return null;
	return m[2] ? { documentId: m[1], messageId: m[2] } : { documentId: m[1] };
}

/** Formats a byte count for people: "820 B", "14 KB", "3.2 MB". */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)} ${units[unit]}`;
}

export function isPdf(mime: string, name = ""): boolean {
	return mime === "application/pdf" || /\.pdf$/i.test(name);
}
