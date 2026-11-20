import { describe, expect, it } from "vitest";
import { appendPage, fetchAll, pageFrom, refreshFirstPage } from "./paging";

const key = (x: { id: string }) => x.id;
const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe("paging", () => {
	it("adapts list responses", () => {
		expect(pageFrom({ messages: [1, 2], nextCursor: "c" }, "messages")).toEqual(
			{
				items: [1, 2],
				nextCursor: "c",
			},
		);
		const last: { documents: number[]; nextCursor?: string } = {
			documents: [],
		};
		expect(pageFrom(last, "documents")).toEqual({ items: [] });
	});

	it("appends a page, replacing rows that moved", () => {
		expect(appendPage(rows("a", "b", "c"), rows("c", "d"), key)).toEqual(
			rows("a", "b", "c", "d"),
		);
	});

	it("refreshes the first page and keeps rows loaded beyond it", () => {
		// a new row "n" arrived on top; "b" was pushed down; "x" was loaded later.
		expect(
			refreshFirstPage(rows("a", "b", "x", "y"), rows("n", "a"), key, 2),
		).toEqual(rows("n", "a", "x", "y"));
		expect(refreshFirstPage(rows("a", "b"), rows("a", "b"), key, 2)).toEqual(
			rows("a", "b"),
		);
	});

	it("follows cursors to the end, bounded", async () => {
		const pages: Record<string, { items: number[]; nextCursor?: string }> = {
			start: { items: [1, 2], nextCursor: "p2" },
			p2: { items: [3, 4], nextCursor: "p3" },
			p3: { items: [5] },
		};
		const fetchPage = async (c?: string) => pages[c ?? "start"] as never;
		expect(await fetchAll<number>(fetchPage)).toEqual([1, 2, 3, 4, 5]);
		expect(await fetchAll<number>(fetchPage, 3)).toEqual([1, 2, 3]);
	});
});
