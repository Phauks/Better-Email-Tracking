import { describe, expect, it } from "vitest";
import { renderTemplate } from "./merge";
import {
	firstNameOf,
	nudgeFields,
	replySubject,
	stepsFromPolicy,
} from "./nudges";

/** How the Worker renders a nudge step (HTML) and the extension previews one (text). */
const html = (t: string, r: Parameters<typeof nudgeFields>[0], f = {}) =>
	renderTemplate(t, nudgeFields(r, f), { html: true, escapeFallbacks: false })
		.output;
const text = (t: string, r: Parameters<typeof nudgeFields>[0], f = {}) =>
	renderTemplate(t, nudgeFields(r, f)).output;

describe("nudge templates", () => {
	it("keeps the old placeholders working, escaping values", () => {
		const t = "Hi {{firstName|there}} ({{ email }}), {{name}}";
		expect(html(t, [{ email: "a@x.com", name: "Ann <b>Lee</b>" }])).toBe(
			"Hi Ann (a@x.com), Ann &lt;b&gt;Lee&lt;/b&gt;",
		);
		expect(html(t, [{ email: "a@x.com" }])).toBe("Hi there (a@x.com), ");
		expect(
			html("Hi {{firstName|team}}", [
				{ email: "a@x.com", name: "Ann" },
				{ email: "b@x.com", name: "Bob" },
			]),
		).toBe("Hi team");
		expect(text("{{name}}", [{ email: "a", name: "A&B" }])).toBe("A&B");
	});

	it("treats fallbacks of HTML templates as markup, like before", () => {
		// textToHtml already escaped "Tom & Jerry" in the nudge text.
		expect(html("Hi {{firstName|Tom &amp; Jerry}}", [{ email: "a@x" }])).toBe(
			"Hi Tom &amp; Jerry",
		);
		expect(renderTemplate("{{x|a & b}}", {}, { html: true }).output).toBe(
			"a &amp; b",
		);
	});

	it("adds merge fields for mail merge copies", () => {
		const r = [{ email: "ada@x.io", name: "Ada Lovelace" }];
		const fields = { first_name: "Countess", company: "Engines & Co" };
		expect(html("{{firstName}} at {{company|you}}", r, fields)).toBe(
			"Countess at Engines &amp; Co",
		);
		expect(html("{{first_name}} {{email}}", r)).toBe("Ada ada@x.io");
		expect(html("{{ Company | there }}", r)).toBe("there");
		// Several recipients: only shared merge fields, names fall back.
		expect(
			html("{{firstName|all}} {{company}}", [...r, { email: "b@x" }], {
				company: "X",
			}),
		).toBe("all X");
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
