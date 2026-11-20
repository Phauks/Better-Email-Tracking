import type { FeedEvent } from "@bet/shared";
import { describe, expect, it } from "vitest";
import {
	badgeText,
	eventsToNotify,
	mergeActivity,
	unseenCount,
} from "./activity";

const ev = (
	id: number,
	source: FeedEvent["source"] = "direct",
	extra: Partial<FeedEvent> = {},
): FeedEvent => ({
	id,
	messageId: "m",
	type: "open",
	at: id * 1000,
	source,
	subject: "s",
	recipients: [{ email: "a@x.com" }],
	...extra,
});

describe("activity", () => {
	it("merges newest first, dedupes, drops ignored", () => {
		const a = mergeActivity([], [ev(1), ev(2)], false);
		expect(a.map((e) => e.id)).toEqual([2, 1]);
		const b = mergeActivity(
			a,
			[ev(2), ev(3), ev(4, "direct", { ignored: "owner" })],
			false,
		);
		expect(b.map((e) => e.id)).toEqual([3, 2, 1]);
	});
	it("counts unseen, optionally skipping machine opens", () => {
		const items = mergeActivity([], [ev(1), ev(2, "apple_proxy")], false);
		expect(unseenCount(items, true)).toBe(2);
		expect(unseenCount(items, false)).toBe(1);
		expect(
			unseenCount(
				items.map((i) => ({ ...i, seen: true })),
				true,
			),
		).toBe(0);
	});
	it("filters notifications by setting", () => {
		const events = [ev(1), ev(2, "apple_proxy"), ev(3, "scanner")];
		expect(
			eventsToNotify(events, { notify: false, notifyMachineOpens: true }),
		).toEqual([]);
		expect(
			eventsToNotify(events, { notify: true, notifyMachineOpens: false }).map(
				(e) => e.id,
			),
		).toEqual([1]);
		expect(
			eventsToNotify(events, { notify: true, notifyMachineOpens: true }),
		).toHaveLength(3);
	});
	it("formats the badge", () => {
		expect(badgeText(0)).toBe("");
		expect(badgeText(5)).toBe("5");
		expect(badgeText(120)).toBe("99+");
	});
});
