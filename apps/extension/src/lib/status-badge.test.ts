import { describe, expect, it } from "vitest";
import { badgeForStatus } from "./status-badge";

describe("badgeForStatus", () => {
	it("maps each status to an icon", () => {
		expect(
			badgeForStatus({ status: "unopened", opens: 0, clicks: 0 }).icon,
		).toBe("check");
		const machine = badgeForStatus({
			status: "machine_only",
			opens: 0,
			clicks: 0,
		});
		expect(machine.icon).toBe("check");
		expect(machine.tooltip).toContain(
			"Opened by a mail privacy proxy, may not be read",
		);
		expect(badgeForStatus({ status: "opened", opens: 2, clicks: 0 }).icon).toBe(
			"checks",
		);
		expect(
			badgeForStatus({ status: "clicked", opens: 1, clicks: 1 }).icon,
		).toBe("cursor-click");
	});

	it("includes counts, recency and per-recipient lines", () => {
		const now = 1_000_000_000;
		const b = badgeForStatus(
			{
				status: "opened",
				opens: 3,
				clicks: 1,
				lastEventAt: now - 2 * 3600_000,
				recipients: [
					{ email: "a@x.com", status: "opened" },
					{ email: "b@y.com", status: "unopened" },
				],
			},
			now,
		);
		expect(b.tooltip).toContain("3 opens, 1 click");
		expect(b.tooltip).toContain("2h ago");
		expect(b.tooltip).toContain("a@x.com: opened");
		expect(b.tooltip).toContain("b@y.com: not opened");
	});
});
