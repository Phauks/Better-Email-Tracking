/**
 * Generic request-parsing helpers shared by every module's validate.ts. Parsers return
 * Parsed<T> instead of throwing so routes can answer 400 with the reason.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });

export const fail = (error: string): { ok: false; error: string } => ({
	ok: false,
	error,
});

export function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** undefined, null or a string. */
export const optString = (v: unknown): v is string | undefined =>
	v === undefined || v === null || typeof v === "string";

/** A finite number within [min, max]. */
export const isNum = (v: unknown, min: number, max: number): v is number =>
	typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** An integer within [min, max]. */
export const isInt = (v: unknown, min: number, max: number): v is number =>
	typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** A number rounded and clamped into [min, max], or the fallback when it isn't one. */
export function clampInt(
	v: unknown,
	fallback: number,
	min: number,
	max: number,
): number {
	if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
	return Math.min(max, Math.max(min, Math.round(v)));
}

const MAX_URL = 4096;

export function isHttpUrl(value: string): boolean {
	if (value.length > MAX_URL) return false;
	try {
		const u = new URL(value);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

/** Integer query parameter, clamped; the fallback when absent or not a number. */
export function intParam(
	value: string | undefined,
	fallback: number,
	min: number,
	max: number,
): number {
	const n = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

/** The JSON body, or undefined when it is missing or malformed (parsers then reject it). */
export async function readJson(req: Request): Promise<unknown> {
	try {
		return await req.json();
	} catch {
		return undefined;
	}
}
