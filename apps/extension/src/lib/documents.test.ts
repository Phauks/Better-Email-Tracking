import { instrumentHtml, trackingUrls } from "@bet/shared";
import { describe, expect, it } from "vitest";
import { DocumentsClient } from "../api/documents";
import {
	base64ToBytes,
	bytesToBase64,
	documentLinkHtml,
	documentRecipientLabel,
	dwellBars,
	formatDuration,
	shouldHintAttachments,
} from "./documents";
import { describeEvent } from "./feed";

const DOC = "doc0000000000000000001";
const MSG = "msg0000000000000000001";

describe("documentLinkHtml", () => {
	it("escapes the name and survives instrumentation as a per-message link", () => {
		const urls = trackingUrls("https://t.example.com");
		const html = documentLinkHtml({
			name: 'Q3 "plan" <final>.pdf',
			url: urls.document(DOC),
			size: 2048,
		});
		expect(html).toContain("Q3 &quot;plan&quot; &lt;final&gt;.pdf");
		expect(html).toContain("(2 KB)");
		const r = instrumentHtml(`<p>Hi</p>${html}`, {
			messageId: MSG,
			urls,
			trackOpens: true,
			trackLinks: true,
		});
		expect(r.documents).toEqual([DOC]);
		expect(r.links).toEqual([]);
		expect(r.html).toContain(`href="https://t.example.com/d/${DOC}/${MSG}"`);
	});
});

describe("attachment hint", () => {
	it("hints once, only for tracked emails with known attachments", () => {
		const base = { tracking: true, hasAttachments: true, alreadyHinted: false };
		expect(shouldHintAttachments(base)).toBe(true);
		expect(shouldHintAttachments({ ...base, alreadyHinted: true })).toBe(false);
		expect(shouldHintAttachments({ ...base, tracking: false })).toBe(false);
		expect(shouldHintAttachments({ ...base, hasAttachments: undefined })).toBe(
			false,
		);
		expect(shouldHintAttachments({ ...base, hasAttachments: false })).toBe(
			false,
		);
	});
});

describe("dwell chart and labels", () => {
	it("fills missing pages and scales to the longest page", () => {
		const bars = dwellBars(
			[
				{ page: 1, dwellMs: 2000, views: 1 },
				{ page: 3, dwellMs: 8000, views: 2 },
			],
			4,
		);
		expect(bars.map((b) => [b.page, b.ratio])).toEqual([
			[1, 0.25],
			[2, 0],
			[3, 1],
			[4, 0],
		]);
		expect(dwellBars([])).toEqual([]);
	});

	it("formats durations and recipients", () => {
		expect(formatDuration(45_200)).toBe("45s");
		expect(formatDuration(192_000)).toBe("3m 12s");
		expect(formatDuration(3_900_000)).toBe("1h 05m");
		const row = { views: 0, downloads: 0, dwellMs: 0 };
		expect(
			documentRecipientLabel({ ...row, messageId: null, recipients: [] }),
		).toBe("Shared link (no recipient)");
		expect(
			documentRecipientLabel({
				...row,
				messageId: MSG,
				recipients: [{ email: "a@x.com", name: "Ana" }, { email: "b@x.com" }],
			}),
		).toBe("Ana +1");
	});

	it("describes document views in the feed", () => {
		expect(
			describeEvent({
				type: "doc_view",
				source: "direct",
				subject: "Proposal",
				recipients: [{ email: "ana@x.com" }],
				documentName: "Deck.pdf",
			}),
		).toEqual({ title: "ana@x.com viewed “Deck.pdf”", detail: "Proposal" });
	});
});

describe("base64 transfer", () => {
	it("round-trips binary larger than one chunk", () => {
		const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
		expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
	});
});

describe("DocumentsClient", () => {
	it("uploads raw bytes with the name in the query and surfaces server errors", async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const fetchImpl = (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			if (calls.length === 1)
				return new Response(
					JSON.stringify({ id: DOC, name: "a b.pdf", url: "u", size: 3 }),
					{ status: 201, headers: { "content-type": "application/json" } },
				);
			return new Response(
				JSON.stringify({ error: "file is over the 25 MB limit" }),
				{
					status: 413,
				},
			);
		}) as unknown as typeof fetch;
		const api = new DocumentsClient("https://t.example.com", "tok", fetchImpl);
		const res = await api.uploadDocument(
			"a b.pdf",
			"application/pdf",
			new Uint8Array([1, 2, 3]),
		);
		expect(res.id).toBe(DOC);
		expect(calls[0]?.url).toBe(
			"https://t.example.com/api/documents?name=a%20b.pdf",
		);
		expect(calls[0]?.init.method).toBe("POST");
		expect(
			(calls[0]?.init.headers as Record<string, string> | undefined)
				?.Authorization,
		).toBe("Bearer tok");
		await expect(
			api.uploadDocument("big.pdf", "application/pdf", new Uint8Array(1)),
		).rejects.toThrow(/413 file is over the 25 MB limit/);
	});
});
