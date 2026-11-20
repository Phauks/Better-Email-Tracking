import { parseDocumentLink } from "./documents";
import type { TrackingUrls } from "./urls";

export interface InstrumentOptions {
	messageId: string;
	urls: TrackingUrls;
	trackOpens: boolean;
	trackLinks: boolean;
	/** Return false to leave a link untouched (e.g. unsubscribe links). */
	shouldTrackLink?: (url: string) => boolean;
}

export interface InstrumentResult {
	html: string;
	links: string[];
	/** Tracked document ids whose links were made per-message (never click-wrapped). */
	documents: string[];
}

const ANCHOR_HREF = /(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gi;
const PIXEL_MARKER = "data-bet-pixel";

function decodeEntities(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

/**
 * Adds the open pixel and rewrites http(s) links through the click redirect.
 * String-based so it runs in any environment (content script, Worker, tests).
 * Idempotent: an already-instrumented body is left alone.
 */
export function instrumentHtml(
	html: string,
	opts: InstrumentOptions,
): InstrumentResult {
	if (html.includes(PIXEL_MARKER)) return { html, links: [], documents: [] };
	const links: string[] = [];
	const documents: string[] = [];
	let out = html;
	const docBase = opts.urls.document("x").replace(/\/d\/x$/, "");
	const base = opts.urls.click(opts.messageId, 0).replace(/\/0$/, "/");
	out = out.replace(
		ANCHOR_HREF,
		(match, prefix: string, quote: string, raw: string) => {
			const url = decodeEntities(raw.trim());
			if (!/^https?:\/\//i.test(url)) return match;
			// Document links become per-message so a view names its recipient.
			const doc = parseDocumentLink(url, docBase);
			if (doc) {
				if (!documents.includes(doc.documentId)) documents.push(doc.documentId);
				return `${prefix}${quote}${opts.urls.document(doc.documentId, opts.messageId)}${quote}`;
			}
			if (!opts.trackLinks) return match;
			if (url.startsWith(base)) return match;
			if (opts.shouldTrackLink && !opts.shouldTrackLink(url)) return match;
			const idx = links.length;
			links.push(url);
			return `${prefix}${quote}${opts.urls.click(opts.messageId, idx)}${quote}`;
		},
	);
	if (opts.trackOpens) {
		const pixel = `<img ${PIXEL_MARKER} src="${opts.urls.pixel(opts.messageId)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0">`;
		out = `${out}${pixel}`;
	}
	return { html: out, links, documents };
}

/** True if an image URL (possibly proxied, e.g. Gmail's ...#https://host/o/id.gif) is our pixel. */
export function extractPixelMessageId(
	src: string,
	trackerBase: string,
): string | null {
	const base = trackerBase.replace(/\/+$/, "");
	const at = src.lastIndexOf(`${base}/o/`);
	if (at === -1) return null;
	const m = /^\/o\/([0-9A-Za-z]{16,32})\.gif/.exec(src.slice(at + base.length));
	return m?.[1] ?? null;
}
