import {
	type DocumentPageStats,
	type DocumentRecipientStats,
	escapeHtml,
	formatBytes,
	isPdf,
} from "@bet/shared";
import type { IconName } from "../ui/icons";
import { recipientLabel } from "./feed";

/** Pure helpers for tracked documents (compose link, hints, dashboard). */

/**
 * The chip inserted into the email body. Inline styles only (mail clients strip
 * <style>), no images (blocked or proxied). Instrumentation later makes the href
 * per-message.
 */
export function documentLinkHtml(doc: {
	name: string;
	url: string;
	size: number;
}): string {
	const label = `${escapeHtml(doc.name)}`;
	const size = formatBytes(doc.size);
	return (
		`<a href="${escapeHtml(doc.url)}" target="_blank" ` +
		'style="display:inline-block;padding:8px 12px;margin:4px 0;border:1px solid #dadce0;border-radius:8px;' +
		'color:#1a73e8;text-decoration:none;font-weight:500">' +
		`&#128196;&nbsp;${label}${size ? ` <span style="color:#5f6368;font-weight:400">(${size})</span>` : ""}</a>&nbsp;`
	);
}

/**
 * Whether to suggest a tracked document instead of a normal attachment: only when the
 * email will be tracked and real attachments are present, once per compose.
 */
export function shouldHintAttachments(args: {
	tracking: boolean;
	hasAttachments: boolean | undefined;
	alreadyHinted: boolean;
}): boolean {
	return args.tracking && args.hasAttachments === true && !args.alreadyHinted;
}

export const ATTACHMENT_HINT =
	"Normal attachments can't be tracked. To see who opens a file and which pages they read, use “Attach tracked document” in the toolbar instead.";

export function documentIcon(mime: string, name = ""): IconName {
	return isPdf(mime, name) ? "file-pdf" : "file-text";
}

/** "3m 12s", "45s", "1h 05m". */
export function formatDuration(ms: number): string {
	const s = Math.round(Math.max(0, ms) / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

export interface DwellBar {
	page: number;
	dwellMs: number;
	views: number;
	/** 0..1 relative to the longest page. */
	ratio: number;
}

/** One bar per page 1..pageCount (missing pages at zero) for the dwell chart. */
export function dwellBars(
	pages: DocumentPageStats[],
	pageCount?: number,
): DwellBar[] {
	const byPage = new Map(pages.map((p) => [p.page, p]));
	const last = Math.max(pageCount ?? 0, ...pages.map((p) => p.page), 0);
	const max = Math.max(1, ...pages.map((p) => p.dwellMs));
	const bars: DwellBar[] = [];
	for (let page = 1; page <= last; page++) {
		const p = byPage.get(page);
		const dwellMs = p?.dwellMs ?? 0;
		bars.push({ page, dwellMs, views: p?.views ?? 0, ratio: dwellMs / max });
	}
	return bars;
}

export function documentRecipientLabel(r: DocumentRecipientStats): string {
	if (r.messageId === null) return "Shared link (no recipient)";
	return recipientLabel(r.recipients);
}

/** Base64 for runtime messages (JSON only), chunked to avoid call-stack limits. */
export function bytesToBase64(bytes: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < bytes.length; i += 0x8000)
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
