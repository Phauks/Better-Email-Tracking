import type { MessageSummary } from "@bet/shared";
import { describe, expect, it } from "vitest";
import { filterEntries, groupMessages } from "./dashboard";

const msg = (
	id: string,
	extra: Partial<MessageSummary> = {},
): MessageSummary => ({
	id,
	provider: "gmail",
	subject: "Hi",
	recipients: [{ email: `${id}@x.com` }],
	mode: "shared",
	createdAt: 1,
	opens: 0,
	machineOpens: 0,
	clicks: 0,
	...extra,
});

describe("dashboard grouping", () => {
	const entries = groupMessages([
		msg("a", { createdAt: 5 }),
		msg("b", { groupId: "g", mode: "individual", createdAt: 10, opens: 1 }),
		msg("c", { groupId: "g", mode: "individual", createdAt: 10 }),
		msg("d", { createdAt: 1, machineOpens: 2 }),
	]);
	it("groups copies and sorts newest first", () => {
		expect(entries.map((e) => e.key)).toEqual(["g:g", "a", "d"]);
		const g = entries[0];
		expect(g?.kind === "group" && g.messages.length).toBe(2);
		expect(g?.status).toBe("opened");
	});
	it("filters by status, matching any copy in a group", () => {
		expect(filterEntries(entries, "unopened").map((e) => e.key)).toEqual([
			"g:g",
			"a",
		]);
		expect(filterEntries(entries, "machine_only").map((e) => e.key)).toEqual([
			"d",
		]);
		expect(filterEntries(entries, "all")).toHaveLength(3);
	});
});
