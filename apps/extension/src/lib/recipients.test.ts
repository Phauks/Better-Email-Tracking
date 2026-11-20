import { describe, expect, it } from "vitest";
import { normalizeDomains } from "../settings";
import { shouldTrackLink } from "./links";
import {
	blockedRecipients,
	domainMatches,
	emailDomain,
	uniqueRecipients,
} from "./recipients";

describe("never-track domains", () => {
	const list = normalizeDomains(["@Acme.com ", "lawfirm.co.uk", ""]);
	it("normalizes the list", () => {
		expect(list).toEqual(["acme.com", "lawfirm.co.uk"]);
	});
	it("matches domains and subdomains only", () => {
		expect(domainMatches("acme.com", list)).toBe(true);
		expect(domainMatches("mail.acme.com", list)).toBe(true);
		expect(domainMatches("notacme.com", list)).toBe(false);
		expect(domainMatches("", list)).toBe(false);
	});
	it("finds blocked recipients", () => {
		const blocked = blockedRecipients(
			[{ email: "Bob@ACME.com" }, { email: "ana@gmail.com" }],
			list,
		);
		expect(blocked.map((r) => r.email)).toEqual(["Bob@ACME.com"]);
		expect(emailDomain("x")).toBe("");
	});
	it("dedupes recipients case-insensitively", () => {
		expect(
			uniqueRecipients([
				{ email: "a@x.com" },
				{ email: "A@X.com" },
				{ email: "b@x.com" },
			]),
		).toEqual([{ email: "a@x.com" }, { email: "b@x.com" }]);
	});
});

describe("shouldTrackLink", () => {
	it("skips unsubscribe links", () => {
		expect(shouldTrackLink("https://x.com/unsubscribe?u=1")).toBe(false);
		expect(shouldTrackLink("https://x.com/opt-out")).toBe(false);
		expect(shouldTrackLink("https://x.com/pricing")).toBe(true);
	});
});
