import { describe, expect, it } from "vitest";
import {
	firstNameOf,
	renderNudgeTemplate,
	replySubject,
	stepsFromPolicy,
} from "./nudges";

describe("nudge templates", () => {
	it("fills placeholders from one recipient, escaping HTML", () => {
		const t = "Hi {{firstName|there}} ({{ email }}), {{name}}";
		expect(
			renderNudgeTemplate(t, [{ email: "a@x.com", name: "Ann <b>Lee</b>" }]),
		).toBe("Hi Ann (a@x.com), Ann &lt;b&gt;Lee&lt;/b&gt;");
		expect(renderNudgeTemplate(t, [{ email: "a@x.com" }])).toBe(
			"Hi there (a@x.com), ",
		);
		expect(
			renderNudgeTemplate("Hi {{firstName|team}}", [
				{ email: "a@x.com", name: "Ann" },
				{ email: "b@x.com", name: "Bob" },
			]),
		).toBe("Hi team");
		expect(
			renderNudgeTemplate("{{name}}", [{ email: "a", name: "A&B" }], {
				html: false,
			}),
		).toBe("A&B");
	});

	it("handles 'Last, First' names and reply subjects", () => {
		expect(firstNameOf({ email: "x", name: "Lee, Ann" })).toBe("Ann");
		expect(replySubject("Plan")).toBe("Re: Plan");
		expect(replySubject("RE: Plan")).toBe("RE: Plan");
	});

	it("expands a policy into steps", () => {
		expect(
			stepsFromPolicy(
				{ firstAfterDays: 3, intervalDays: 4, maxNudges: 3 },
				"x",
			),
		).toEqual([
			{ afterDays: 3, html: "x" },
			{ afterDays: 4, html: "x" },
			{ afterDays: 4, html: "x" },
		]);
		expect(
			stepsFromPolicy(
				{ firstAfterDays: 1, intervalDays: 1, maxNudges: 99 },
				"x",
			),
		).toHaveLength(10);
	});
});
