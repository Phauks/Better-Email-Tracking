import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, pageOf } from "./pagination";

describe("cursors", () => {
	it("round-trips key values, unicode included", () => {
		const c = encodeCursor([1_700_000_000_000, "abc", "zoë@例え.jp"]);
		expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeCursor(c, ["number", "string", "string"])).toEqual([
			1_700_000_000_000,
			"abc",
			"zoë@例え.jp",
		]);
	});

	it("rejects malformed or mismatched cursors", () => {
		expect(decodeCursor(undefined, ["number"])).toBeNull();
		expect(decodeCursor("!!", ["number"])).toBeNull();
		expect(decodeCursor(encodeCursor(["x"]), ["number"])).toBeNull();
		expect(decodeCursor(encodeCursor([1, 2]), ["number"])).toBeNull();
		expect(decodeCursor(encodeCursor([null]), ["string"])).toBeNull();
	});

	it("pages rows fetched with limit + 1", () => {
		const rows = [1, 2, 3];
		expect(pageOf(rows, 3, (n) => [n])).toEqual({ items: rows });
		const p = pageOf(rows, 2, (n) => [n]);
		expect(p.items).toEqual([1, 2]);
		expect(decodeCursor(p.nextCursor, ["number"])).toEqual([2]);
	});
});
