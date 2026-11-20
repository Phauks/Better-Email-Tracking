import { describe, expect, it } from "vitest";
import {
	formatBytes,
	instrumentHtml,
	isPdf,
	parseDocumentLink,
	trackingUrls,
} from "./index";

const urls = trackingUrls("https://t.example.com/");
const DOC = "doc0000000000000000001";
const MSG = "msg0000000000000000001";
const OLD = "msg0000000000000000099";

describe("parseDocumentLink", () => {
	it("parses bare and per-message links on the tracker host only", () => {
		const base = "https://t.example.com";
		expect(parseDocumentLink(`${base}/d/${DOC}`, base)).toEqual({
			documentId: DOC,
		});
		expect(
			parseDocumentLink(`${base}/d/${DOC}/${MSG}?x=1`, `${base}/`),
		).toEqual({ documentId: DOC, messageId: MSG });
		expect(parseDocumentLink(`https://T.EXAMPLE.com/d/${DOC}`, base)).toEqual({
			documentId: DOC,
		});
		for (const bad of [
			`https://evil.com/d/${DOC}`,
			`${base}/d/short`,
			`${base}/d/${DOC}/${MSG}/file`,
			`${base}/c/${DOC}/0`,
			`${base}.evil.com/d/${DOC}`,
		])
			expect(parseDocumentLink(bad, base), bad).toBeNull();
		expect(parseDocumentLink(`${base}/d/${DOC}`, "")).toBeNull();
	});
});

describe("instrumentHtml with documents", () => {
	it("makes document links per-message and never click-wraps them", () => {
		const html = `<a href="https://t.example.com/d/${DOC}">Deck.pdf</a> <a href="https://a.com/">a</a> <a href='https://t.example.com/d/${DOC}/${OLD}'>again</a>`;
		const r = instrumentHtml(html, {
			messageId: MSG,
			urls,
			trackOpens: true,
			trackLinks: true,
		});
		expect(r.documents).toEqual([DOC]);
		expect(r.links).toEqual(["https://a.com/"]);
		expect(r.html).toContain(`href="https://t.example.com/d/${DOC}/${MSG}"`);
		expect(r.html).toContain(`href='https://t.example.com/d/${DOC}/${MSG}'`);
		expect(r.html).not.toContain(OLD);
		expect(r.html).toContain(`href="https://t.example.com/c/${MSG}/0"`);
	});

	it("rewrites document links even when link tracking is off", () => {
		const r = instrumentHtml(
			`<a href="https://t.example.com/d/${DOC}">d</a><a href="https://a.com/">a</a>`,
			{ messageId: MSG, urls, trackOpens: false, trackLinks: false },
		);
		expect(r.documents).toEqual([DOC]);
		expect(r.links).toEqual([]);
		expect(r.html).toContain(`/d/${DOC}/${MSG}"`);
		expect(r.html).toContain('href="https://a.com/"');
	});

	it("gives each individual-send copy its own document link", () => {
		const body = `<a href="${urls.document(DOC)}">d</a>`;
		const a = instrumentHtml(body, {
			messageId: MSG,
			urls,
			trackOpens: true,
			trackLinks: true,
		});
		const b = instrumentHtml(body, {
			messageId: OLD,
			urls,
			trackOpens: true,
			trackLinks: true,
		});
		expect(a.html).toContain(urls.document(DOC, MSG));
		expect(b.html).toContain(urls.document(DOC, OLD));
	});
});

describe("document helpers", () => {
	it("formats sizes and detects pdfs", () => {
		expect(formatBytes(820)).toBe("820 B");
		expect(formatBytes(14 * 1024)).toBe("14 KB");
		expect(formatBytes(3.24 * 1024 * 1024)).toBe("3.2 MB");
		expect(formatBytes(1024 * 1024)).toBe("1 MB");
		expect(isPdf("application/pdf")).toBe(true);
		expect(isPdf("application/octet-stream", "x.PDF")).toBe(true);
		expect(isPdf("image/png", "x.png")).toBe(false);
	});
});
