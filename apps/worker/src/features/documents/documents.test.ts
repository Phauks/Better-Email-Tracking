import type {
	DocumentDetail,
	FeedResponse,
	ListDocumentRecipientsResponse,
	ListDocumentsResponse,
	ListMessagesResponse,
	MessageDetail,
	UploadDocumentResponse,
} from "@bet/shared";
import { describe, expect, it } from "vitest";
import { runScheduled } from "../../app";
import type { MemoryStore } from "../../core/store/memory";
import type { Env } from "../../env";
import { modules } from "../../modules";
import { CHROME_UA, setup, T0 } from "../../test-utils";
import { createDocumentsModule } from "./index";
import { MemoryObjectStore } from "./objects";
import { pdfPageCount } from "./pdf";
import { MemoryDocumentStore } from "./store/memory";
import { parseViewerEvents } from "./validate";

const SEC = 1000;
const MSG = "msg0000000000000000001";
const MSG2 = "msg0000000000000000002";
const PDF = new TextEncoder().encode("%PDF-1.4 fake pdf bytes");

function docsSetup(env: Partial<Env> & { DOCS_MAX_MB?: string } = {}) {
	const docs = { store: null as unknown as MemoryDocumentStore };
	const objects = new MemoryObjectStore();
	const makeModules = (core: MemoryStore) => {
		docs.store = new MemoryDocumentStore(core);
		return [
			...modules.filter((m) => m.name !== "documents"),
			createDocumentsModule({
				store: () => docs.store,
				objects: () => objects,
			}),
		];
	};
	const s = setup(env as Partial<Env>, makeModules);
	const docStore = docs.store;

	async function upload(
		name = "Deck.pdf",
		type = "application/pdf",
		body: Uint8Array = PDF,
	) {
		const res = await s.request(
			`/api/documents?name=${encodeURIComponent(name)}`,
			{ method: "POST", body, headers: { "Content-Type": type } },
		);
		expect(res.status).toBe(201);
		return (await res.json()) as UploadDocumentResponse;
	}

	/** Beacon from the viewer page, as a recipient's browser would send it. */
	const beacon = (path: string, body: unknown, opts = {}) =>
		s.request(`${path}/events`, {
			method: "POST",
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
			ua: CHROME_UA,
			ip: "198.51.100.7",
			...opts,
		});

	async function view(path: string, extra: object = {}, opts = {}) {
		const res = await beacon(
			path,
			{ events: [{ type: "view" }], ...extra },
			opts,
		);
		expect(res.status).toBe(200);
		return ((await res.json()) as { viewId?: number }).viewId;
	}

	const detail = async (id: string) =>
		(await (await s.request(`/api/documents/${id}`)).json()) as DocumentDetail;

	return { ...s, docStore, objects, upload, beacon, view, detail };
}

describe("document upload, list and delete", () => {
	it("stores the file in the object store and lists it", async () => {
		const s = docsSetup();
		const up = await s.upload("Q3 plan.pdf");
		expect(up).toMatchObject({
			name: "Q3 plan.pdf",
			mime: "application/pdf",
			size: PDF.byteLength,
			url: `https://t.example.com/d/${up.id}`,
		});
		expect(s.objects.objects.get(`documents/${up.id}`)?.type).toBe(
			"application/pdf",
		);
		const list = (await (
			await s.request("/api/documents")
		).json()) as ListDocumentsResponse;
		expect(list.documents).toHaveLength(1);
		expect(list.documents[0]?.stats).toEqual({
			views: 0,
			uniqueViewers: 0,
			downloads: 0,
			totalDwellMs: 0,
		});
	});

	it("accepts multipart uploads and cleans names and types", async () => {
		const s = docsSetup();
		const form = new FormData();
		form.set(
			"file",
			new File([PDF], "../evil\u0000name.pdf", {
				type: "application/octet-stream",
			}),
		);
		const res = await s.request("/api/documents", {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(201);
		const up = (await res.json()) as UploadDocumentResponse;
		expect(up.name).toBe(".._evilname.pdf");
		expect(up.mime).toBe("application/pdf");
	});

	it("requires auth, enforces the size cap and needs the bucket", async () => {
		const s = docsSetup({ DOCS_MAX_MB: "0.00001" });
		expect(
			(await s.request("/api/documents", { method: "POST", auth: false }))
				.status,
		).toBe(401);
		expect((await s.request("/api/documents", { auth: false })).status).toBe(
			401,
		);
		const big = await s.request("/api/documents?name=a.pdf", {
			method: "POST",
			body: PDF,
		});
		expect(big.status).toBe(413);
		const empty = await s.request("/api/documents?name=a.pdf", {
			method: "POST",
			body: new Uint8Array(0),
		});
		expect(empty.status).toBe(400);

		const noBucket = setup({}, () => [
			...modules.filter((m) => m.name !== "documents"),
			createDocumentsModule({
				store: () => new MemoryDocumentStore(),
				objects: () => null,
			}),
		]);
		const res = await noBucket.request("/api/documents?name=a.pdf", {
			method: "POST",
			body: PDF,
		});
		expect(res.status).toBe(503);
	});

	it("deletes the object, its events and its feed rows", async () => {
		const s = docsSetup();
		const up = await s.upload();
		await s.register({ id: MSG });
		await s.markSent(MSG, T0);
		s.clock.now = T0 + 120 * SEC;
		await s.view(`/d/${up.id}/${MSG}`);
		expect(s.store.events.some((e) => e.type === "doc_view")).toBe(true);
		const res = await s.request(`/api/documents/${up.id}`, {
			method: "DELETE",
		});
		expect(res.status).toBe(200);
		expect(s.objects.objects.size).toBe(0);
		expect(s.docStore.events).toHaveLength(0);
		expect(s.store.events.some((e) => e.type === "doc_view")).toBe(false);
		expect((await s.request(`/d/${up.id}/${MSG}`)).status).toBe(404);
		expect(
			(await s.request(`/api/documents/${up.id}`, { method: "DELETE" })).status,
		).toBe(404);
	});
});

describe("viewer", () => {
	it("serves a pdf viewer with pinned pdf.js, a strict CSP and no caching", async () => {
		const s = docsSetup();
		const up = await s.upload("Deck <1>.pdf");
		const res = await s.request(`/d/${up.id}/${MSG}`);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toMatch(/pdf\.js\/\d+\.\d+\.\d+\/pdf\.min\.mjs/);
		expect(html).toContain("Deck &lt;1&gt;.pdf");
		expect(html).not.toContain("Deck <1>");
		expect(html).toContain(`/d/${up.id}/${MSG}/events`);
		const csp = res.headers.get("Content-Security-Policy") ?? "";
		const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
		expect(nonce).toBeTruthy();
		expect(html).toContain(`nonce="${nonce}"`);
		// Scripts: the nonce plus the pinned pdf.js directory only.
		expect(csp).toMatch(
			/script-src 'nonce-[^']+' https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/\d+\.\d+\.\d+\/ /,
		);
		expect(res.headers.get("Cache-Control")).toContain("no-store");
		// Loading the page alone records nothing: the view comes from the script.
		expect(s.docStore.events).toHaveLength(0);
	});

	it("serves a download landing page for other files", async () => {
		const s = docsSetup();
		const up = await s.upload("notes.txt", "text/plain");
		const html = await (await s.request(`/d/${up.id}`)).text();
		expect(html).toContain("notes.txt");
		expect(html).toContain(`/d/${up.id}/file?download=1`);
		expect(html).toContain('"pdf":false');
	});

	it("streams the file inline or as a download, forcing download for active types", async () => {
		const s = docsSetup();
		const up = await s.upload("Deck.pdf");
		const inline = await s.request(`/d/${up.id}/${MSG}/file`);
		expect(inline.status).toBe(200);
		expect(inline.headers.get("Content-Type")).toBe("application/pdf");
		expect(inline.headers.get("Content-Disposition")).toMatch(/^inline;/);
		expect(inline.headers.get("Cache-Control")).toContain("no-store");
		expect(new Uint8Array(await inline.arrayBuffer())).toEqual(PDF);
		const dl = await s.request(`/d/${up.id}/file?download=1`);
		expect(dl.headers.get("Content-Disposition")).toContain(
			'attachment; filename="Deck.pdf"',
		);
		const svg = await s.upload("x.svg", "image/svg+xml");
		const res = await s.request(`/d/${svg.id}/file`);
		expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
		expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
	});

	it("404s malformed and unknown ids", async () => {
		const s = docsSetup();
		const up = await s.upload();
		for (const path of [
			"/d/short",
			`/d/${up.id}/bad`,
			"/d/unknownunknownunknown1",
			`/d/${up.id}/..%2Fx/file`,
		])
			expect((await s.request(path)).status, path).toBe(404);
		expect((await s.beacon(`/d/${up.id}/bad`, { events: [] })).status).toBe(
			404,
		);
	});
});

describe("viewer events", () => {
	it("attributes views, page dwell and downloads to the message", async () => {
		const s = docsSetup();
		const up = await s.upload();
		await s.register({ id: MSG, recipients: [{ email: "ana@example.com" }] });
		await s.markSent(MSG, T0);
		s.clock.now = T0 + 120 * SEC;
		const path = `/d/${up.id}/${MSG}`;
		const viewId = await s.view(path, { pageCount: 3 });
		expect(viewId).toBeGreaterThan(0);
		await s.beacon(path, {
			viewId,
			events: [
				{ type: "page", page: 1, dwellMs: 4000 },
				{ type: "page", page: 2, dwellMs: 1500.4 },
				{ type: "page", page: 9, dwellMs: 1000 }, // beyond pageCount: ignored
				{ type: "page", page: 2, dwellMs: -5 }, // dropped
				{ type: "nope" },
				{ type: "download" },
			],
		});
		const d = await s.detail(up.id);
		expect(d.pageCount).toBe(3);
		expect(d.stats).toMatchObject({
			views: 1,
			uniqueViewers: 1,
			downloads: 1,
			totalDwellMs: 5500,
		});
		expect(d.pages).toEqual([
			{ page: 1, dwellMs: 4000, views: 1 },
			{ page: 2, dwellMs: 1500, views: 1 },
		]);
		expect(d.recipients).toHaveLength(1);
		expect(d.recipients[0]).toMatchObject({
			messageId: MSG,
			recipients: [{ email: "ana@example.com" }],
			views: 1,
			downloads: 1,
			dwellMs: 5500,
		});
		expect(JSON.stringify(d)).not.toContain("ipHash");
	});

	it("tells individual-send copies apart and lists linked messages not yet viewed", async () => {
		const s = docsSetup();
		const up = await s.upload();
		await s.register({
			id: MSG,
			recipients: [{ email: "a@example.com" }],
			mode: "individual",
		});
		await s.register({
			id: MSG2,
			recipients: [{ email: "b@example.com" }],
			mode: "individual",
		});
		for (const id of [MSG, MSG2]) {
			const res = await s.request("/api/documents/attach", {
				json: { messageId: id, documentIds: [up.id] },
			});
			expect(res.status).toBe(200);
		}
		s.clock.now = T0 + 120 * SEC;
		await s.view(`/d/${up.id}/${MSG2}`);
		await s.view(`/d/${up.id}/${MSG2}`);
		const d = await s.detail(up.id);
		expect(d.stats).toMatchObject({ views: 2, uniqueViewers: 1 });
		expect(d.recipients.map((r) => [r.recipients[0]?.email, r.views])).toEqual([
			["b@example.com", 2],
			["a@example.com", 0],
		]);
	});

	it("counts the bare link as unattributed and unknown messages fall back to it", async () => {
		const s = docsSetup();
		const up = await s.upload();
		s.clock.now = T0 + 120 * SEC;
		await s.view(`/d/${up.id}`);
		await s.view(`/d/${up.id}/msg0000000000000000404`, {}, { ip: "192.0.2.1" });
		const d = await s.detail(up.id);
		expect(d.stats).toMatchObject({ views: 2, uniqueViewers: 2 });
		expect(d.recipients).toEqual([
			expect.objectContaining({ messageId: null, views: 2 }),
		]);
		expect(s.store.events).toHaveLength(0); // no message, nothing in the feed
	});

	it("suppresses the owner's views (send grace, owner window, owner ip) and their dwell", async () => {
		const s = docsSetup();
		const up = await s.upload();
		await s.register({ id: MSG });
		await s.markSent(MSG, T0);
		const path = `/d/${up.id}/${MSG}`;

		s.clock.now = T0 + 5 * SEC; // send grace
		await s.view(path);
		s.clock.now = T0 + 300 * SEC;
		await s.request("/api/owner-views", {
			json: { messageIds: [MSG] },
			ip: "203.0.113.50",
		});
		s.clock.now += 10 * SEC; // owner window
		const ownerView = await s.view(path, {}, { ip: "198.51.100.99" });
		s.clock.now += 10 * 60 * SEC; // window over, but the beacon inherits the view's flag
		await s.beacon(path, {
			viewId: ownerView,
			events: [{ type: "page", page: 1, dwellMs: 9000 }],
		});
		await s.view(path, {}, { ip: "203.0.113.50" }); // owner's ip, any time later

		const ignored = s.docStore.events.map((e) => e.ignored);
		expect(ignored).toEqual(["send_grace", "owner", "owner", "owner"]);
		const d = await s.detail(up.id);
		expect(d.stats).toMatchObject({ views: 0, totalDwellMs: 0 });
		expect(d.events).toHaveLength(4);
	});

	it("labels scanners and does not count them", async () => {
		const s = docsSetup();
		const up = await s.upload();
		s.clock.now = T0 + 120 * SEC;
		await s.view(`/d/${up.id}`, {}, { ua: "python-requests/2.31" });
		expect(s.docStore.events[0]?.source).toBe("scanner");
		expect((await s.detail(up.id)).stats.views).toBe(0);
	});

	it("rejects oversized and malformed beacons", async () => {
		const s = docsSetup();
		const up = await s.upload();
		const huge = await s.beacon(`/d/${up.id}`, {
			events: [{ type: "view", pad: "x".repeat(10_000) }],
		});
		expect(huge.status).toBe(413);
		const bad = await s.request(`/d/${up.id}/events`, {
			method: "POST",
			body: "not json",
		});
		expect(bad.status).toBe(400);
		const missing = await s.beacon("/d/unknownunknownunknown1", {
			events: [{ type: "view" }],
		});
		expect(missing.status).toBe(404);
		expect(s.docStore.events).toHaveLength(0);
	});

	it("ignores a viewId from another document", async () => {
		const s = docsSetup();
		const a = await s.upload("a.pdf");
		const b = await s.upload("b.pdf");
		s.clock.now = T0 + 120 * SEC;
		const viewA = await s.view(`/d/${a.id}`, {}, { ua: "curl/8" });
		await s.beacon(`/d/${b.id}`, {
			viewId: viewA,
			events: [{ type: "page", page: 1, dwellMs: 1000 }],
		});
		const ev = s.docStore.events.at(-1);
		expect(ev?.viewId).toBeUndefined();
		expect(ev?.source).toBe("direct");
	});
});

describe("feed and counts", () => {
	it("puts document views in the feed without changing open or click counts", async () => {
		const s = docsSetup();
		const up = await s.upload("Pricing.pdf");
		await s.register({ id: MSG });
		await s.markSent(MSG, T0);
		s.clock.now = T0 + 120 * SEC;
		await s.view(`/d/${up.id}/${MSG}`);
		const feed = (await (await s.request("/api/feed")).json()) as FeedResponse;
		expect(feed.events).toHaveLength(1);
		expect(feed.events[0]).toMatchObject({
			type: "doc_view",
			messageId: MSG,
			documentId: up.id,
			documentName: "Pricing.pdf",
			subject: "Hello",
		});
		const list = (await (
			await s.request("/api/messages")
		).json()) as ListMessagesResponse;
		expect(list.messages[0]).toMatchObject({
			opens: 0,
			machineOpens: 0,
			clicks: 0,
		});
		expect(list.messages[0]?.lastEventAt).toBeUndefined();
		const md = (await (
			await s.request(`/api/messages/${MSG}`)
		).json()) as MessageDetail;
		expect(md.events[0]?.type).toBe("doc_view");
		const status = (await (
			await s.request("/api/thread-status?ids=none")
		).json()) as { threads: object };
		expect(status.threads).toEqual({});
	});
});

describe("document retention", () => {
	it("purges old events and old documents with their objects", async () => {
		const s = docsSetup();
		const old = await s.upload("old.pdf");
		s.clock.now = T0 + 120 * SEC;
		await s.view(`/d/${old.id}`);
		s.clock.now = T0 + 170 * 86_400 * SEC;
		const fresh = await s.upload("fresh.pdf");
		await s.view(`/d/${fresh.id}`);
		await runScheduled(
			s.env,
			"17 3 * * *",
			{ store: () => s.store, now: () => T0 + 200 * 86_400 * SEC },
			[
				createDocumentsModule({
					store: () => s.docStore,
					objects: () => s.objects,
				}),
			],
		);
		expect([...s.docStore.documents.keys()]).toEqual([fresh.id]);
		expect([...s.objects.objects.keys()]).toEqual([`documents/${fresh.id}`]);
		expect(s.docStore.events).toHaveLength(1);
	});
});

describe("parseViewerEvents", () => {
	it("caps batches and clamps dwell", () => {
		const r = parseViewerEvents({
			viewId: 3,
			events: Array.from({ length: 80 }, () => ({
				type: "page",
				page: 1,
				dwellMs: 99 * 60 * 60 * 1000,
			})),
		});
		expect(r.ok && r.value.events.length).toBe(50);
		expect(r.ok && r.value.events[0]?.dwellMs).toBe(30 * 60 * 1000);
		expect(parseViewerEvents([]).ok).toBe(false);
		expect(parseViewerEvents({ viewId: -1, events: [] })).toEqual({
			ok: true,
			value: { events: [] },
		});
	});
});

/** A minimal PDF whose page tree root says /Count n (with nested dictionaries). */
function pdfWithPages(n: number): Uint8Array {
	return new TextEncoder().encode(
		`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
			`2 0 obj\n<< /Type /Pages /Resources << /Font << /F1 5 0 R >> >> /Kids [3 0 R 4 0 R] /Count ${n} >>\nendobj\n` +
			"3 0 obj\n<< /Type /Pages /Parent 2 0 R /Kids [] /Count 1 >>\nendobj\n%%EOF\n",
	);
}

/** The same page tree inside a compressed object stream (PDF 1.5+). */
async function pdfWithObjectStream(n: number): Promise<Uint8Array> {
	const objects = new TextEncoder().encode(
		`2 0 << /Type /Pages /Kids [3 0 R] /Count ${n} >>`,
	);
	const deflated = new Uint8Array(
		await new Response(
			new Blob([objects])
				.stream()
				.pipeThrough(new CompressionStream("deflate")),
		).arrayBuffer(),
	);
	const head = new TextEncoder().encode(
		`%PDF-1.5\n7 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${deflated.length} >>\nstream\n`,
	);
	const tail = new TextEncoder().encode("\nendstream\nendobj\n%%EOF\n");
	const out = new Uint8Array(head.length + deflated.length + tail.length);
	out.set(head, 0);
	out.set(deflated, head.length);
	out.set(tail, head.length + deflated.length);
	return out;
}

describe("page count", () => {
	it("is read from the PDF at upload, so a viewer can't set it", async () => {
		expect(await pdfPageCount(pdfWithPages(12).buffer as ArrayBuffer)).toBe(12);
		expect(
			await pdfPageCount((await pdfWithObjectStream(7)).buffer as ArrayBuffer),
		).toBe(7);
		expect(await pdfPageCount(PDF.buffer as ArrayBuffer)).toBeUndefined();

		const s = docsSetup();
		const up = await s.upload("Deck.pdf", "application/pdf", pdfWithPages(4));
		await s.register({ id: MSG });
		await s.markSent(MSG, T0);
		s.clock.now = T0 + 120 * SEC;
		const path = `/d/${up.id}/${MSG}`;
		const viewId = await s.view(path, { pageCount: 1 }); // bogus report
		await s.beacon(path, {
			viewId,
			events: [
				{ type: "page", page: 3, dwellMs: 1000 },
				{ type: "page", page: 5, dwellMs: 1000 }, // beyond the real count
			],
		});
		const d = await s.detail(up.id);
		expect(d.pageCount).toBe(4);
		expect(d.pages.map((p) => p.page)).toEqual([3]);
	});
});

describe("document pagination", () => {
	it("pages the list and the per-recipient rows with stable cursors", async () => {
		const s = docsSetup();
		const ids: string[] = [];
		for (let i = 0; i < 5; i++) ids.push((await s.upload(`d${i}.pdf`)).id);
		const seen: string[] = [];
		let cursor: string | undefined;
		do {
			const page = (await (
				await s.request(
					`/api/documents?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
				)
			).json()) as ListDocumentsResponse;
			expect(page.documents.length).toBeLessThanOrEqual(2);
			seen.push(...page.documents.map((d) => d.id));
			cursor = page.nextCursor;
		} while (cursor);
		expect([...seen].sort()).toEqual([...ids].sort());
		expect(new Set(seen).size).toBe(5);

		// One document sent in 7 messages; two of them viewed.
		const doc = ids[0] as string;
		const msgs = Array.from(
			{ length: 7 },
			(_, i) => `dmsg00000000000000000${i}`,
		);
		for (const [i, id] of msgs.entries()) {
			await s.register({ id, recipients: [{ email: `p${i}@x.io` }] });
			await s.markSent(id, T0 + i * SEC);
			await s.request("/api/documents/attach", {
				json: { messageId: id, documentIds: [doc] },
			});
		}
		s.clock.now = T0 + 600 * SEC;
		await s.view(`/d/${doc}/${msgs[2]}`);
		s.clock.now = T0 + 700 * SEC;
		await s.view(`/d/${doc}/${msgs[5]}`);

		const first = await s.request(`/api/documents/${doc}?limit=3`);
		const d = (await first.json()) as DocumentDetail;
		const order = d.recipients.map((r) => r.messageId);
		let next = d.recipientsNextCursor;
		while (next) {
			const page = (await (
				await s.request(
					`/api/documents/${doc}/recipients?limit=3&cursor=${next}`,
				)
			).json()) as ListDocumentRecipientsResponse;
			order.push(...page.recipients.map((r) => r.messageId));
			next = page.nextCursor;
		}
		// Viewed first (latest view first), then by most recent send.
		expect(order).toEqual([
			msgs[5],
			msgs[2],
			msgs[6],
			msgs[4],
			msgs[3],
			msgs[1],
			msgs[0],
		]);
		expect(
			(await s.request(`/api/documents/${doc}/recipients?cursor=nope`)).status,
		).toBe(400);
	});
});
