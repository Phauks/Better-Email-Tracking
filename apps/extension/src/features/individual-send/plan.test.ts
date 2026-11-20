import { describe, expect, it } from "vitest";
import { planIndividualSend } from "./plan";

let n = 0;
const makeId = () => `id${++n}`;
const rs = (to: string[], cc: string[] = [], bcc: string[] = []) => ({
	to: to.map((email) => ({ email })),
	cc: cc.map((email) => ({ email })),
	bcc: bcc.map((email) => ({ email })),
});

describe("planIndividualSend", () => {
	it("splits To, CC and BCC into one copy each, deduped", () => {
		const plan = planIndividualSend(
			{
				recipients: rs(
					["a@x.com", "b@x.com"],
					["c@x.com", "A@x.com"],
					["d@x.com"],
				),
				hasAttachments: false,
				isReply: false,
			},
			makeId,
		);
		expect(plan.kind).toBe("split");
		if (plan.kind !== "split") return;
		expect(plan.copies.map((c) => c.recipient.email)).toEqual([
			"a@x.com",
			"b@x.com",
			"c@x.com",
			"d@x.com",
		]);
		const ids = new Set([plan.groupId, ...plan.copies.map((c) => c.id)]);
		expect(ids.size).toBe(5);
	});

	it("doesn't split a single recipient", () => {
		expect(
			planIndividualSend(
				{
					recipients: rs(["a@x.com"], ["a@x.com"]),
					hasAttachments: false,
					isReply: false,
				},
				makeId,
			),
		).toEqual({
			kind: "shared",
			reason: "single_recipient",
		});
	});

	it("falls back for attachments, unknown attachments and replies", () => {
		const two = rs(["a@x.com", "b@x.com"]);
		expect(
			planIndividualSend(
				{ recipients: two, hasAttachments: true, isReply: false },
				makeId,
			),
		).toEqual({
			kind: "shared",
			reason: "attachments",
		});
		expect(
			planIndividualSend(
				{ recipients: two, hasAttachments: undefined, isReply: false },
				makeId,
			),
		).toEqual({
			kind: "shared",
			reason: "attachments_unknown",
		});
		expect(
			planIndividualSend(
				{ recipients: two, hasAttachments: false, isReply: true },
				makeId,
			),
		).toEqual({
			kind: "shared",
			reason: "reply",
		});
	});
});
