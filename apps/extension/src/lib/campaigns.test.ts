import {
	type CampaignDetail,
	type CampaignStats,
	DEFAULT_CAMPAIGN_SETTINGS,
	type MergeRecipient,
} from "@bet/shared";
import { describe, expect, it } from "vitest";
import {
	availableFields,
	buildCreateRequest,
	campaignActions,
	estimateMinutes,
	followUpSeed,
	issueText,
	nonOpeners,
	progress,
	statsLine,
} from "./campaigns";

const stats = (s: Partial<CampaignStats> = {}): CampaignStats => ({
	total: 10,
	queued: 0,
	sending: 0,
	sent: 0,
	failed: 0,
	skipped: 0,
	opened: 0,
	clicked: 0,
	machineOnly: 0,
	unopened: 0,
	...s,
});

describe("campaign helpers", () => {
	it("computes progress and a stats line", () => {
		expect(progress(stats({ sent: 3, failed: 1, skipped: 1 }))).toEqual({
			handled: 5,
			total: 10,
			pct: 50,
		});
		expect(progress(stats({ total: 0 })).pct).toBe(0);
		expect(statsLine(stats())).toBe("10 recipients");
		expect(
			statsLine(stats({ sent: 4, opened: 2, clicked: 1, failed: 1 })),
		).toBe("4 sent · 2 opened · 1 clicked · 1 failed");
	});

	it("offers actions by status", () => {
		expect(campaignActions({ status: "draft", stats: stats() })).toEqual([
			"start",
			"cancel",
		]);
		expect(campaignActions({ status: "sending", stats: stats() })).toEqual([
			"pause",
			"cancel",
		]);
		expect(
			campaignActions({ status: "done", stats: stats({ failed: 2 }) }),
		).toEqual(["retry"]);
		expect(campaignActions({ status: "cancelled", stats: stats() })).toEqual(
			[],
		);
	});

	it("follows up with sent recipients who are unopened or machine-only", () => {
		const detail = {
			name: "Launch",
			subjectTemplate: "News for {{company}}",
			recipients: [
				{
					email: "a@x.io",
					state: "sent",
					status: "unopened",
					fields: { company: "A" },
					name: "Ann",
				},
				{ email: "b@x.io", state: "sent", status: "machine_only", fields: {} },
				{ email: "c@x.io", state: "sent", status: "opened", fields: {} },
				{ email: "d@x.io", state: "sent", status: "clicked", fields: {} },
				{ email: "e@x.io", state: "failed", fields: {} },
			],
		} as unknown as CampaignDetail;
		expect(nonOpeners(detail.recipients).map((r) => r.email)).toEqual([
			"a@x.io",
			"b@x.io",
		]);
		const seed = followUpSeed(detail);
		expect(seed.name).toBe("Follow-up: Launch");
		expect(seed.subject).toBe("Re: News for {{company}}");
		expect(seed.recipients[0]).toEqual({
			email: "a@x.io",
			name: "Ann",
			fields: { email: "a@x.io", company: "A", name: "Ann" },
		});
		expect(availableFields(seed.recipients)).toEqual([
			"email",
			"name",
			"company",
		]);
	});

	it("builds a create request, skipping blocked rows under the block policy", () => {
		const recipients: MergeRecipient[] = [
			{ email: "a@x.io", fields: { email: "a@x.io", first_name: "A" } },
			{ email: "b@x.io", name: "B", fields: { email: "b@x.io" } },
		];
		const req = buildCreateRequest({
			id: "id",
			name: " ",
			provider: "gmail",
			subject: "Hi {{first_name}}",
			body: "x",
			recipients,
			settings: { ...DEFAULT_CAMPAIGN_SETTINGS, missingPolicy: "block" },
			start: true,
		});
		expect(req.name).toBe("Untitled campaign");
		expect(req.status).toBe("sending");
		expect(req.recipients[0]?.skipReason).toBeUndefined();
		expect(req.recipients[1]).toMatchObject({
			name: "B",
			skipReason: "Missing: first_name",
		});
		const warn = buildCreateRequest({
			id: "id",
			name: "n",
			provider: "gmail",
			subject: "Hi {{first_name}}",
			body: "x",
			recipients,
			settings: { ...DEFAULT_CAMPAIGN_SETTINGS, missingPolicy: "warn" },
			start: false,
		});
		expect(warn.status).toBe("draft");
		expect(warn.recipients.every((r) => !r.skipReason)).toBe(true);
	});

	it("estimates run time and describes row issues", () => {
		expect(estimateMinutes(1, DEFAULT_CAMPAIGN_SETTINGS)).toBe(0);
		expect(estimateMinutes(31, DEFAULT_CAMPAIGN_SETTINGS)).toBe(15);
		expect(estimateMinutes(500, DEFAULT_CAMPAIGN_SETTINGS)).toBe(25); // capped at 50
		expect(issueText({ row: 2, kind: "invalid_email", value: "x" })).toContain(
			"not a valid",
		);
	});
});
