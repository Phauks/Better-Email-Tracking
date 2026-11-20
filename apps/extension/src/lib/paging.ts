import type { Paged } from "@bet/shared";

/** One page from a cursor-paginated Worker list. */
export interface PageResult<T> {
	items: T[];
	nextCursor?: string;
}

/** Adapts a list response ({ <field>: T[], nextCursor? }) to a PageResult. */
export function pageFrom<R extends Paged, K extends keyof R>(
	res: R,
	field: K,
): PageResult<R[K] extends (infer T)[] ? T : never> {
	const items = res[field] as unknown as (R[K] extends (infer T)[]
		? T
		: never)[];
	return res.nextCursor ? { items, nextCursor: res.nextCursor } : { items };
}

/** Appends a page, replacing rows already shown (a row can move between pages). */
export function appendPage<T>(
	existing: T[],
	incoming: T[],
	key: (item: T) => string,
): T[] {
	const fresh = new Map(incoming.map((i) => [key(i), i]));
	return [...existing.filter((i) => !fresh.has(key(i))), ...incoming];
}

/**
 * A refreshed first page over a longer list: the first page as it is now, then the
 * rows loaded beyond it that it doesn't contain. Keeps "Load more" progress across
 * live refreshes.
 */
export function refreshFirstPage<T>(
	existing: T[],
	firstPage: T[],
	key: (item: T) => string,
	previousFirstPageSize: number,
): T[] {
	const seen = new Set(firstPage.map(key));
	const beyond = existing
		.slice(previousFirstPageSize)
		.filter((i) => !seen.has(key(i)));
	return [...firstPage, ...beyond];
}

/** Follows cursors until the end (or `max` rows), e.g. every non-opener of a campaign. */
export async function fetchAll<T>(
	fetchPage: (cursor?: string) => Promise<PageResult<T>>,
	max = 10_000,
): Promise<T[]> {
	const out: T[] = [];
	let cursor: string | undefined;
	do {
		const page = await fetchPage(cursor);
		out.push(...page.items);
		cursor = page.nextCursor;
	} while (cursor && out.length < max);
	return out.slice(0, max);
}
