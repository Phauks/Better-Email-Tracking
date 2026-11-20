/**
 * Cursor pagination shared by every list endpoint. Lists are ordered by a stable key
 * (for example (createdAt DESC, id DESC)); a page answers `nextCursor` when more rows
 * follow, and the client passes it back as `cursor`. Cursors are opaque to clients.
 */

export type CursorValue = string | number | null;

/** Answered by every paginated list. Absent on the last page. */
export interface Paged {
	nextCursor?: string;
}

export interface PageQuery {
	cursor?: string;
	limit?: number;
}

/** Page sizes: default and maximum per list. */
export const PAGE_LIMITS = {
	messages: { default: 50, max: 200 },
	campaigns: { default: 50, max: 200 },
	recipients: { default: 100, max: 500 },
	documents: { default: 50, max: 200 },
	documentRecipients: { default: 100, max: 500 },
	nudges: { default: 50, max: 200 },
} as const;

function toBase64Url(text: string): string {
	let bin = "";
	for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(raw: string): string {
	const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
	const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
	return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Encodes the sort key of the last row of a page. */
export function encodeCursor(values: CursorValue[]): string {
	return toBase64Url(JSON.stringify(values));
}

export type CursorShape = readonly ("string" | "number")[];

/**
 * Decodes a cursor made by encodeCursor, checking it has `shape` (one type per key
 * part). Returns null for anything malformed, so a bad cursor is a 400, never a crash.
 */
export function decodeCursor<const S extends CursorShape>(
	raw: string | undefined,
	shape: S,
):
	| { -readonly [K in keyof S]: S[K] extends "number" ? number : string }
	| null {
	if (!raw || raw.length > 1024) return null;
	try {
		const v: unknown = JSON.parse(fromBase64Url(raw));
		if (!Array.isArray(v) || v.length !== shape.length) return null;
		for (let i = 0; i < shape.length; i++) {
			const want = shape[i];
			const got = v[i];
			if (
				want === "number" &&
				!(typeof got === "number" && Number.isFinite(got))
			)
				return null;
			if (want === "string" && typeof got !== "string") return null;
		}
		return v as never;
	} catch {
		return null;
	}
}

/**
 * Splits `rows` fetched with limit + 1: the page, and the cursor of its last row when
 * a further row exists.
 */
export function pageOf<T>(
	rows: T[],
	limit: number,
	keyOf: (row: T) => CursorValue[],
): { items: T[]; nextCursor?: string } {
	if (rows.length <= limit) return { items: rows };
	const items = rows.slice(0, limit);
	const last = items[items.length - 1] as T;
	return { items, nextCursor: encodeCursor(keyOf(last)) };
}
