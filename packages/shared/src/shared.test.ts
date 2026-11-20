import { describe, expect, it } from "vitest";
import {
	classifyRequest,
	extractPixelMessageId,
	instrumentHtml,
	isValidId,
	newId,
	statusFromCounts,
	trackingUrls,
} from "./index";

const urls = trackingUrls("https://t.example.com/");

describe("ids", () => {
	it("makes valid unique ids", () => {
		const a = newId();
		expect(isValidId(a)).toBe(true);
		expect(a).not.toBe(newId());
		expect(isValidId("../etc")).toBe(false);
	});
});

describe("instrumentHtml", () => {
	const id = "abcdefghijklmnop1234";
	it("adds a pixel and rewrites http links only", () => {
		const html =
			'<p>Hi <a href="https://a.com/x?y=1&amp;z=2">a</a> <a href="mailto:me@x.com">m</a></p>';
		const r = instrumentHtml(html, {
			messageId: id,
			urls,
			trackOpens: true,
			trackLinks: true,
		});
		expect(r.links).toEqual(["https://a.com/x?y=1&z=2"]);
		expect(r.html).toContain(`href="https://t.example.com/c/${id}/0"`);
		expect(r.html).toContain("mailto:me@x.com");
		expect(r.html).toContain(`https://t.example.com/o/${id}.gif`);
	});
	it("is idempotent and respects shouldTrackLink", () => {
		const html = '<a href="https://a.com/unsubscribe">u</a>';
		const r = instrumentHtml(html, {
			messageId: id,
			urls,
			trackOpens: true,
			trackLinks: true,
			shouldTrackLink: (u) => !u.includes("unsubscribe"),
		});
		expect(r.links).toEqual([]);
		expect(
			instrumentHtml(r.html, {
				messageId: id,
				urls,
				trackOpens: true,
				trackLinks: true,
			}).html,
		).toBe(r.html);
	});
	it("finds the pixel inside a proxied Gmail image url", () => {
		const src = `https://ci3.googleusercontent.com/meips/xyz#https://t.example.com/o/${id}.gif`;
		expect(extractPixelMessageId(src, "https://t.example.com")).toBe(id);
		expect(
			extractPixelMessageId(
				"https://other.com/o/x.gif",
				"https://t.example.com",
			),
		).toBeNull();
	});
});

describe("classifyRequest", () => {
	it("labels proxies and scanners", () => {
		expect(
			classifyRequest({
				userAgent: "Mozilla/5.0 (via ggpht.com GoogleImageProxy)",
			}),
		).toBe("google_proxy");
		expect(classifyRequest({ userAgent: "Mozilla/5.0", asn: 714 })).toBe(
			"apple_proxy",
		);
		expect(classifyRequest({ userAgent: "python-requests/2.0" })).toBe(
			"scanner",
		);
		expect(
			classifyRequest({
				userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120",
				asOrganization: "Comcast",
			}),
		).toBe("direct");
	});
});

describe("status", () => {
	it("ranks clicks over opens over machine opens", () => {
		expect(statusFromCounts(0, 0, 1)).toBe("clicked");
		expect(statusFromCounts(1, 3, 0)).toBe("opened");
		expect(statusFromCounts(0, 2, 0)).toBe("machine_only");
		expect(statusFromCounts(0, 0, 0)).toBe("unopened");
	});
});
