import type {
	DocumentDetail,
	DocumentEvent,
	DocumentPageStats,
	DocumentRecipientStats,
	DocumentStats,
	DocumentSummary,
} from "@bet/shared";
import type { StoredMessage } from "../../core/store/types";
import type { StoredDocEvent, StoredDocument } from "./store/types";

/** Owner, send-grace and scanner events are kept for the timeline but never counted. */
export function isCountedDocEvent(e: StoredDocEvent): boolean {
	return !e.ignored && e.source !== "scanner";
}

function viewerKey(e: StoredDocEvent): string {
	if (e.messageId) return `m:${e.messageId}`;
	if (e.ipHash) return `ip:${e.ipHash}`;
	return `v:${e.id}`;
}

export function documentStats(events: StoredDocEvent[]): DocumentStats {
	const s: DocumentStats = {
		views: 0,
		uniqueViewers: 0,
		downloads: 0,
		totalDwellMs: 0,
	};
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

export function toDocumentSummary(
	doc: StoredDocument,
	events: StoredDocEvent[],
	url: string,
): DocumentSummary {
	const out: DocumentSummary = {
		id: doc.id,
		name: doc.name,
		mime: doc.mime,
		size: doc.size,
		createdAt: doc.createdAt,
		url,
		stats: documentStats(events),
	};
	if (doc.pages !== undefined) out.pageCount = doc.pages;
	return out;
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

/**
 * One row per tracked message the document went out in (viewed or not), plus a
 * messageId-null row for views through the bare, unattributed link.
 */
export function recipientStats(
	events: StoredDocEvent[],
	linkedMessageIds: string[],
	messages: Map<string, StoredMessage>,
): DocumentRecipientStats[] {
	const rows = new Map<string, DocumentRecipientStats>();
	const row = (messageId: string | null): DocumentRecipientStats => {
		const key = messageId ?? "";
		let r = rows.get(key);
		if (!r) {
			const m = messageId ? messages.get(messageId) : undefined;
			r = {
				messageId,
				recipients: m?.recipients ?? [],
				views: 0,
				downloads: 0,
				dwellMs: 0,
			};
			if (m) r.subject = m.subject;
			if (m?.sentAt !== undefined) r.sentAt = m.sentAt;
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
	return [...rows.values()].sort(
		(a, b) =>
			(b.lastViewedAt ?? 0) - (a.lastViewedAt ?? 0) ||
			(b.sentAt ?? 0) - (a.sentAt ?? 0),
	);
}

export function toDocumentEvent(e: StoredDocEvent): DocumentEvent {
	const { ipHash: _ip, documentId: _doc, viewId: _view, ...rest } = e;
	return rest;
}

export const TIMELINE_LIMIT = 300;

export function toDocumentDetail(
	doc: StoredDocument,
	events: StoredDocEvent[],
	linkedMessageIds: string[],
	messages: Map<string, StoredMessage>,
	url: string,
): DocumentDetail {
	return {
		...toDocumentSummary(doc, events, url),
		recipients: recipientStats(events, linkedMessageIds, messages),
		pages: pageStats(events),
		events: events.slice(-TIMELINE_LIMIT).reverse().map(toDocumentEvent),
	};
}
