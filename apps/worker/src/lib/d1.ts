/** Helpers shared by the D1 store implementations (core and every feature module). */

/** D1 caps bound parameters per statement at 100; IN lists stay well below. */
export const D1_CHUNK = 50;

/** Splits a list into D1-sized parts for `IN (...)` queries. */
export function chunks<T>(items: T[], size = D1_CHUNK): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
}

/** "?,?,?" for n bound parameters. */
export function placeholders(n: number): string {
	return Array.from({ length: n }, () => "?").join(",");
}

/** Parses a JSON column, falling back on NULL, malformed JSON or a value `accept` rejects. */
export function parseJson<T>(
	raw: string | null,
	fallback: T,
	accept: (v: unknown) => boolean = () => true,
): T {
	if (raw === null) return fallback;
	try {
		const v: unknown = JSON.parse(raw);
		return accept(v) ? (v as T) : fallback;
	} catch {
		return fallback;
	}
}

/** A LIKE pattern matching `text` anywhere; use with `ESCAPE '\'`. */
export function likeContains(text: string): string {
	return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
