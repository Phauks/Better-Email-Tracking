import { describe, expect, it, vi } from "vitest";
import { ThreadStatusCache } from "./cache";

describe("ThreadStatusCache", () => {
	it("batches lookups and caches results including misses", async () => {
		const fetch = vi.fn(async (ids: string[]) => ({
			threads: Object.fromEntries(
				ids
					.filter((id) => id !== "none")
					.map((id) => [
						id,
						{ status: "opened" as const, opens: 1, clicks: 0 },
					]),
			),
		}));
		let now = 0;
		const cache = new ThreadStatusCache(fetch, 60_000, 0, () => now);
		const [a, b, none] = await Promise.all([
			cache.get("a"),
			cache.get("b"),
			cache.get("none"),
		]);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]?.[0]).toEqual(["a", "b", "none"]);
		expect(a?.status).toBe("opened");
		expect(b?.opens).toBe(1);
		expect(none).toBeNull();
		await cache.get("none");
		expect(fetch).toHaveBeenCalledTimes(1);
		now = 61_000;
		await cache.get("a");
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
