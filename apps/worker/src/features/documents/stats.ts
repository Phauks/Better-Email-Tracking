import type {
	DocumentDetail,
	DocumentEvent,
	DocumentPageStats,
	DocumentRecipientStats,
	DocumentStats,
	DocumentSummary,
} from "@bet/shared";
import type { StoredMessage } from "../../core/store/types";
import {
	type DocRecipientKey,
	type DocRecipientRow,
	docRecipientKey,
	type StoredDocEvent,
	type StoredDocument,
} from "./store/types";

/*
 * Reference implementations over event lists. The memory store uses them as they are;
 * the D1 store computes the same numbers with SQL aggregates (a test keeps them equal).
 */

/** Owner, send-grace and scanner events are kept for the timeline but never counted. */
export function isCountedDocEvent(e: StoredDocEvent): boolean {
	return !e.ignored && e.source !== "scanner";
}

function viewerKey(e: StoredDocEvent): string {
	if (e.messageId) return `m:${e.messageId}`;
	if (e.ipHash) return `ip:${e.ipHash}`;
	return `v:${e.id}`;
}

export function emptyDocumentStats(): DocumentStats {
	return { views: 0, uniqueViewers: 0, downloads: 0, totalDwellMs: 0 };
}

export function documentStats(events: StoredDocEvent[]): DocumentStats {
	const s = emptyDocumentStats();
	const viewers = new Set<string>();
	for (const e of events) {
		if (!isCountedDocEvent(e)) continue;
		if (e.type === "view") {
			s.views++;
			viewers.add(viewerKey(e));
			if (s.lastViewedAt === undefined || e.at > s.lastViewedAt)
				s.lastViewedAt = e.at;
		} else if (e.type === "download") s.downloads++;
		else if (e.type === "page") s.totalDwellMs += e.dwellMs ?? 0;
	}
	s.uniqueViewers = viewers.size;
	return s;
}

/** Per-page dwell totals and how many distinct views reached each page. */
export function pageStats(events: StoredDocEvent[]): DocumentPageStats[] {
	const pages = new Map<number, { dwellMs: number; views: Set<string> }>();
	for (const e of events) {
		if (e.type !== "page" || e.page === undefined || !isCountedDocEvent(e))
			continue;
		let p = pages.get(e.page);
		if (!p) {
			p = { dwellMs: 0, views: new Set() };
			pages.set(e.page, p);
		}
		p.dwellMs += e.dwellMs ?? 0;
		p.views.add(e.viewId !== undefined ? String(e.viewId) : `e${e.id}`);
	}
	return [...pages.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([page, p]) => ({ page, dwellMs: p.dwellMs, views: p.views.size }));
}

/** Sort order of keys: descending, part by part (> 0 when `a` comes after `b`). */
export function compareKeys(a: DocRecipientKey, b: DocRecipientKey): number {
	for (let i = 0; i < a.length; i++) {
		if (a[i] === b[i]) continue;
		return (a[i] as number | string) < (b[i] as number | string) ? 1 : -1;
	}
	return 0;
}

export function compareRecipientRows(
	a: DocRecipientRow,
	b: DocRecipientRow,
): number {
	return compareKeys(docRecipientKey(a), docRecipientKey(b));
}

/**
 * One row per tracked message the document went out in (viewed or not), plus a
 * messageId-null row for views through the bare, unattributed link. Sorted.
 */
export function recipientRows(
	events: StoredDocEvent[],
	linkedMessageIds: string[],
	sentAtOf: (messageId: string) => number | undefined,
): DocRecipientRow[] {
	const rows = new Map<string, DocRecipientRow>();
	const row = (messageId: string | null): DocRecipientRow => {
		const key = messageId ?? "";
		let r = rows.get(key);
		if (!r) {
			r = { messageId, views: 0, downloads: 0, dwellMs: 0 };
			const sentAt = messageId ? sentAtOf(messageId) : undefined;
			if (sentAt !== undefined) r.sentAt = sentAt;
			rows.set(key, r);
		}
		return r;
	};
	for (const id of linkedMessageIds) row(id);
	for (const e of events) {
		if (!isCountedDocEvent(e)) continue;
		const r = row(e.messageId ?? null);
		if (e.type === "view") {
			r.views++;
			if (r.lastViewedAt === undefined || e.at > r.lastViewedAt)
				r.lastViewedAt = e.at;
		} else if (e.type === "download") r.downloads++;
		else r.dwellMs += e.dwellMs ?? 0;
	}
	return [...rows.values()].sort(compareRecipientRows);
}

/** A row as the API shows it, with the message's recipients and subject. */
export function toRecipientStats(
	row: DocRecipientRow,
	message: StoredMessage | undefined,
): DocumentRecipientStats {
	const r: DocumentRecipientStats = {
		messageId: row.messageId,
		recipients: message?.recipients ?? [],
		views: row.views,
		downloads: row.downloads,
		dwellMs: row.dwellMs,
	};
	if (message) r.subject = message.subject;
	if (message?.sentAt !== undefined) r.sentAt = message.sentAt;
	if (row.lastViewedAt !== undefined) r.lastViewedAt = row.lastViewedAt;
	return r;
}

export function toDocumentSummary(
	doc: StoredDocument,
	stats: DocumentStats,
	url: string,
): DocumentSummary {
	const out: DocumentSummary = {
		id: doc.id,
		name: doc.name,
		mime: doc.mime,
		size: doc.size,
		createdAt: doc.createdAt,
		url,
		stats,
	};
	if (doc.pages !== undefined) out.pageCount = doc.pages;
	return out;
}

export function toDocumentEvent(e: StoredDocEvent): DocumentEvent {
	const { ipHash: _ip, documentId: _doc, viewId: _view, ...rest } = e;
	return rest;
}

export const TIMELINE_LIMIT = 300;

export function toDocumentDetail(
	summary: DocumentSummary,
	parts: {
		recipients: DocumentRecipientStats[];
		recipientsNextCursor?: string;
		pages: DocumentPageStats[];
		/** Newest first. */
		events: StoredDocEvent[];
	},
): DocumentDetail {
	const d: DocumentDetail = {
		...summary,
		recipients: parts.recipients,
		pages: parts.pages,
		events: parts.events.map(toDocumentEvent),
	};
	if (parts.recipientsNextCursor)
		d.recipientsNextCursor = parts.recipientsNextCursor;
	return d;
}
