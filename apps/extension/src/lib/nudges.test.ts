import type { NudgeSequence } from "@bet/shared";
import { renderTemplate } from "@bet/shared";
import { describe, expect, it } from "vitest";
import { normalizeSettings } from "../settings";
import { describeEvent, eventIcon } from "./feed";
import {
	buildNudgeRequest,
	DEFAULT_NUDGES,
	describePolicy,
	nextActionLabel,
	normalizeNudgeDefaults,
	nudgeMessageIds,
	previewNudge,
	resolveChoice,
	sendWindowFor,
	textToHtml,
} from "./nudges";
import { badgeForStatus } from "./status-badge";

const defaults = normalizeNudgeDefaults({});

describe("follow-up policy", () => {
	it("defaults to 3 days, then every 4, up to 3 nudges", () => {
		expect(defaults).toMatchObject({
			firstAfterDays: 3,
			intervalDays: 4,
			maxNudges: 3,
		});
		expect(describePolicy(defaults)).toBe(
			"After 3 days, then every 4 days · up to 3 nudges",
		);
		expect(
			describePolicy({ firstAfterDays: 1, intervalDays: 2, maxNudges: 1 }),
		).toBe("After 1 day · 1 nudge");
		expect(normalizeSettings({}).nudges).toEqual(defaults);
	});

	it("normalizes stored values", () => {
		const n = normalizeNudgeDefaults({
			firstAfterDays: 0,
			intervalDays: 400,
			maxNudges: 2.6,
			text: "  ",
			window: { startHour: 18, endHour: 9 },
		});
		expect(n).toMatchObject({
			firstAfterDays: 1,
			intervalDays: 90,
			maxNudges: 3,
		});
		expect(n.text).toBe(DEFAULT_NUDGES.text);
		expect(n.window).toMatchObject({ startHour: 9, endHour: 17 });
	});

	it("resolves the compose choice", () => {
		expect(resolveChoice({ kind: "off" }, defaults)).toBeNull();
		expect(resolveChoice({ kind: "default" }, defaults)?.policy.maxNudges).toBe(
			3,
		);
		const custom = resolveChoice(
			{
				kind: "custom",
				policy: { firstAfterDays: 2, intervalDays: 0, maxNudges: 20 },
				text: "Ping",
				stopOnOpen: true,
			},
			defaults,
		);
		expect(custom).toEqual({
			policy: { firstAfterDays: 2, intervalDays: 1, maxNudges: 10 },
			text: "Ping",
			stopOnOpen: true,
		});
	});

	it("turns a policy into Worker steps for one sent copy", () => {
		const resolved = resolveChoice({ kind: "default" }, defaults);
		if (!resolved) throw new Error("expected a policy");
		const req = buildNudgeRequest(
			{
				messageId: "copyA00000000000000001",
				sentAt: 1000,
				providerThreadId: "t-a",
				to: [{ email: "ann@x.com", name: "Ann" }],
				cc: [],
			},
			{ ...resolved, text: "Hi {{firstName|there}},\n\nAny news?\nThanks" },
			sendWindowFor(defaults, "Europe/London"),
		);
		expect(req.steps?.map((s) => s.afterDays)).toEqual([3, 4, 4]);
		expect(req.steps?.[0]?.html).toBe(
			"<p>Hi {{firstName|there}},</p><p>Any news?<br>Thanks</p>",
		);
		expect(req).toMatchObject({
			messageId: "copyA00000000000000001",
			providerThreadId: "t-a",
			sentAt: 1000,
			stopOnOpen: false,
			to: [{ email: "ann@x.com", name: "Ann" }],
			sendWindow: {
				startHour: 9,
				endHour: 17,
				weekdaysOnly: true,
				timeZone: "Europe/London",
			},
		});
		expect(req.cc).toBeUndefined();
		expect(
			sendWindowFor(
				{ ...defaults, window: { ...defaults.window, enabled: false } },
				"UTC",
			),
		).toBeUndefined();
	});
});

describe("nudge templates", () => {
	it("escapes text and fills placeholders per recipient", () => {
		expect(textToHtml("a < b & c")).toBe("<p>a &lt; b &amp; c</p>");
		const html = textToHtml("Hi {{firstName|there}} & co");
		expect(
			renderTemplate(html, [{ email: "a@x.com", name: "José <Pepe>" }]),
		).toBe("<p>Hi José &amp; co</p>");
		expect(
			renderTemplate("{{name}}", [{ email: "a@x.com", name: "José <Pepe>" }]),
		).toBe("José &lt;Pepe&gt;");
		expect(renderTemplate(html, [{ email: "a@x.com" }])).toBe(
			"<p>Hi there &amp; co</p>",
		);
		expect(
			previewNudge("Hi {{firstName|there}}, {{email}}", [
				{ email: "b@x.com", name: "Bo Li" },
			]),
		).toBe("Hi Bo, b@x.com");
		expect(previewNudge("Hi {{name|all}}", [])).toBe("Hi all");
	});
});

describe("follow-ups in the UI", () => {
	const seq = (over: Partial<NudgeSequence>): NudgeSequence => ({
		id: "s",
		messageId: "m",
		connector: "google",
		providerThreadId: "t",
		state: "active",
		steps: [
			{ afterDays: 3, html: "x" },
			{ afterDays: 4, html: "x" },
		],
		nextStep: 0,
		stopOnOpen: false,
		createdAt: 0,
		updatedAt: 0,
		attempts: 0,
		subject: "Hello",
		recipients: [],
		history: [],
		...over,
	});
	const fmt = (at: number) => `@${at}`;

	it("labels the next action", () => {
		expect(nextActionLabel(seq({ nextAt: 5 }), fmt)).toBe("Nudge 1 of 2 · @5");
		expect(nextActionLabel(seq({ nextAt: 9, nextStep: 2 }), fmt)).toBe(
			"Last reply check @9",
		);
		expect(nextActionLabel(seq({ state: "paused", nextStep: 1 }), fmt)).toBe(
			"Paused before nudge 2 of 2",
		);
		expect(nextActionLabel(seq({ state: "replied" }), fmt)).toBe("Replied");
	});

	it("collects nudge message ids", () => {
		const ids = nudgeMessageIds([
			seq({
				history: [
					{ at: 1, kind: "created" },
					{ at: 2, kind: "sent", step: 0, nudgeMessageId: "n1" },
				],
			}),
		]);
		expect([...ids]).toEqual(["n1"]);
	});

	it("describes nudge and reply events", () => {
		const base = {
			source: "direct" as const,
			subject: "Plan",
			recipients: [{ email: "ann@x.com", name: "Ann" }],
		};
		expect(describeEvent({ ...base, type: "nudge_sent" })).toEqual({
			title: "Follow-up sent to Ann",
			detail: "Plan",
		});
		expect(describeEvent({ ...base, type: "reply" }).title).toBe("Ann replied");
		expect(eventIcon({ type: "reply", source: "direct" })).toBe(
			"chat-circle-text",
		);
		expect(eventIcon({ type: "nudge_sent", source: "direct" })).toBe(
			"arrow-bend-up-right",
		);
		expect(
			badgeForStatus(
				{ status: "opened", opens: 1, clicks: 0, replied: true },
				0,
			).tooltip,
		).toContain("Replied");
	});
});
