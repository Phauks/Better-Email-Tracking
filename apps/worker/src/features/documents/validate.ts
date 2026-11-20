import {
	type AttachDocumentsRequest,
	type DocumentEventType,
	isValidId,
	type ViewerEventsRequest,
} from "@bet/shared";
import { fail, isInt, isObject, type Parsed } from "../../lib/parse";

/** Viewer beacons are tiny; anything bigger is not ours. */
export const MAX_VIEWER_BODY = 8 * 1024;
export const MAX_VIEWER_EVENTS = 50;
export const MAX_PAGES = 5000;
/** One flush never reports more than this per page (the viewer flushes every 15s). */
export const MAX_DWELL_MS = 30 * 60 * 1000;

const TYPES = new Set<DocumentEventType>(["view", "page", "download"]);

/**
 * Parses a viewer beacon. Unknown event types and malformed entries are dropped
 * rather than failing the whole batch; page bounds are checked by the caller once
 * the document's page count is known.
 */
export function parseViewerEvents(body: unknown): Parsed<ViewerEventsRequest> {
	if (!isObject(body)) return fail("body must be an object");
	const b = body;
	if (!Array.isArray(b.events)) return fail("events required");
	const value: ViewerEventsRequest = { events: [] };
	if (isInt(b.viewId, 1, Number.MAX_SAFE_INTEGER)) value.viewId = b.viewId;
	if (isInt(b.pageCount, 1, MAX_PAGES)) value.pageCount = b.pageCount;
	for (const raw of b.events.slice(0, MAX_VIEWER_EVENTS)) {
		if (!isObject(raw)) continue;
		const e = raw;
		const type = e.type as DocumentEventType;
		if (!TYPES.has(type)) continue;
		if (type === "page") {
			if (!isInt(e.page, 1, MAX_PAGES)) continue;
			if (typeof e.dwellMs !== "number" || !Number.isFinite(e.dwellMs))
				continue;
			const dwellMs = Math.min(
				MAX_DWELL_MS,
				Math.max(0, Math.round(e.dwellMs)),
			);
			if (dwellMs > 0) value.events.push({ type, page: e.page, dwellMs });
		} else {
			value.events.push({ type });
		}
	}
	return { ok: true, value };
}

export function parseAttach(body: unknown): Parsed<AttachDocumentsRequest> {
	if (!isObject(body)) return fail("invalid body");
	const { messageId, documentIds } = body;
	if (typeof messageId !== "string" || !isValidId(messageId))
		return fail("invalid messageId");
	if (!Array.isArray(documentIds) || documentIds.length > 50)
		return fail("invalid documentIds");
	const ids = documentIds.filter(
		(d): d is string => typeof d === "string" && isValidId(d),
	);
	if (ids.length !== documentIds.length) return fail("invalid documentIds");
	return { ok: true, value: { messageId, documentIds: [...new Set(ids)] } };
}

/** File names are shown to recipients and sent in headers: keep them plain. */
export function cleanFileName(raw: string | null | undefined): string {
	const name = [...(raw ?? "")]
		.filter((ch) => {
			const code = ch.charCodeAt(0);
			return code >= 0x20 && code !== 0x7f;
		})
		.join("")
		.replace(/[\\/]/g, "_")
		.trim()
		.slice(0, 200);
	return name || "document";
}

const MIME =
	/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

export function cleanMime(
	raw: string | null | undefined,
	name: string,
): string {
	const mime = (raw ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
	if (MIME.test(mime) && mime !== "application/octet-stream") return mime;
	if (/\.pdf$/i.test(name)) return "application/pdf";
	return "application/octet-stream";
}

/** Types a browser could execute or render as a page on our origin: always download. */
export function mustDownload(mime: string): boolean {
	return /html|xml|svg|javascript|ecmascript|x-shockwave/i.test(mime);
}

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 filename*. */
export function contentDisposition(
	kind: "inline" | "attachment",
	name: string,
): string {
	const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
	return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
