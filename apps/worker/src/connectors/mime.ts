import type { Recipient } from "@bet/shared";
import { base64UrlEncode } from "../lib/crypto";
import { NUDGE_MARKER_HEADER, type OutgoingReply } from "./types";

/** RFC 2822/5322 message builder for nudge replies. CRLF line endings throughout. */
const CRLF = "\r\n";
const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

/** Base64 body wrapped at 76 characters (RFC 2045). */
export function base64Body(text: string): string {
	const b64 = toBase64(encoder.encode(text));
	return b64.match(/.{1,76}/g)?.join(CRLF) ?? "";
}

/** Strips CR/LF so values can't inject headers. */
export function headerSafe(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim();
}

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/**
 * RFC 2047 "B" encoded-words for non-ASCII text, split on character boundaries so
 * each word stays within 75 characters; words are folded onto continuation lines.
 */
export function encodeHeaderText(value: string): string {
	const clean = headerSafe(value);
	if (PRINTABLE_ASCII.test(clean)) return clean;
	const words: string[] = [];
	let chunk = "";
	// "=?UTF-8?B?" + "?=" is 12 chars, leaving 63 for base64 → at most 45 bytes.
	for (const ch of clean) {
		const next = chunk + ch;
		if (encoder.encode(next).length > 45) {
			words.push(chunk);
			chunk = ch;
		} else chunk = next;
	}
	if (chunk) words.push(chunk);
	return words
		.map((w) => `=?UTF-8?B?${toBase64(encoder.encode(w))}?=`)
		.join(`${CRLF} `);
}

/** "Name <a@b.com>" with the display name quoted or encoded as needed. */
export function formatAddress(r: Recipient): string {
	const email = headerSafe(r.email).replace(/[<>,"]/g, "");
	const name = r.name ? headerSafe(r.name) : "";
	if (!name) return email;
	if (PRINTABLE_ASCII.test(name)) {
		return `"${name.replace(/["\\]/g, "\\$&")}" <${email}>`;
	}
	return `${encodeHeaderText(name)} <${email}>`;
}

/** Message-ID style token: keeps or adds the angle brackets. */
export function msgIdToken(id: string): string {
	const v = headerSafe(id);
	return v.startsWith("<") ? v : `<${v}>`;
}

/** Plain-text alternative from simple HTML. */
export function htmlToText(html: string): string {
	return html
		.replace(/<(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, "\n")
		.replace(/<img\b[^>]*>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function buildReplyMime(
	reply: OutgoingReply,
	boundary = `bet_${crypto.randomUUID().replace(/-/g, "")}`,
): string {
	const headers: string[] = [
		`From: ${headerSafe(reply.from)}`,
		`To: ${reply.to.map(formatAddress).join(", ")}`,
	];
	if (reply.cc?.length)
		headers.push(`Cc: ${reply.cc.map(formatAddress).join(", ")}`);
	headers.push(`Subject: ${encodeHeaderText(reply.subject)}`);
	if (reply.inReplyTo) {
		headers.push(`In-Reply-To: ${msgIdToken(reply.inReplyTo)}`);
	}
	const refs = [...reply.references.map(msgIdToken)];
	if (reply.inReplyTo && !refs.includes(msgIdToken(reply.inReplyTo)))
		refs.push(msgIdToken(reply.inReplyTo));
	if (refs.length) headers.push(`References: ${refs.join(`${CRLF} `)}`);
	headers.push(
		`${NUDGE_MARKER_HEADER}: ${headerSafe(reply.markerId)}`,
		"MIME-Version: 1.0",
		`Content-Type: multipart/alternative; boundary="${boundary}"`,
	);
	const part = (type: string, body: string) =>
		[
			`--${boundary}`,
			`Content-Type: ${type}; charset="UTF-8"`,
			"Content-Transfer-Encoding: base64",
			"",
			base64Body(body),
		].join(CRLF);
	return [
		...headers,
		"",
		part("text/plain", htmlToText(reply.html)),
		part("text/html", reply.html),
		`--${boundary}--`,
		"",
	].join(CRLF);
}

/** Gmail API `raw` field: base64url of the whole message. */
export function toGmailRaw(mime: string): string {
	return base64UrlEncode(encoder.encode(mime));
}
