import {
	DEFAULT_MAX_DOCUMENT_BYTES,
	decodeCursor,
	type IgnoreReason,
	isPdf,
	isValidId,
	type ListDocumentRecipientsResponse,
	type ListDocumentsResponse,
	newId,
	PAGE_LIMITS,
	pageOf,
	type UploadDocumentResponse,
	type ViewerEventsResponse,
} from "@bet/shared";
import { type Context, Hono } from "hono";
import { suppressionReason } from "../../core/events";
import type { Store, StoredMessage } from "../../core/store/types";
import type { Config, Env } from "../../env";
import { NO_STORE_HEADERS } from "../../lib/gif";
import { intParam, readJson } from "../../lib/parse";
import { describeRequest, type RequestFacts } from "../../lib/request";
import type { AppVariables } from "../../types";
import type { DocumentsBindings } from ".";
import { pdfPageCount } from "./pdf";
import {
	emptyDocumentStats,
	TIMELINE_LIMIT,
	toDocumentDetail,
	toDocumentSummary,
	toRecipientStats,
} from "./stats";
import {
	type DocRecipientQuery,
	type DocumentStore,
	docRecipientKey,
	type ObjectStore,
	type StoredDocument,
} from "./store/types";
import {
	cleanFileName,
	cleanMime,
	contentDisposition,
	MAX_PAGES,
	MAX_VIEWER_BODY,
	mustDownload,
	parseAttach,
	parseViewerEvents,
} from "./validate";
import { DOC_NOT_FOUND_HTML, viewerCsp, viewerHtml } from "./viewer-page";

export type DocsEnv = {
	Bindings: Env & DocumentsBindings;
	Variables: AppVariables & {
		docs: DocumentStore;
		objects: ObjectStore | null;
	};
};
type Ctx = Context<DocsEnv>;

export function maxUploadBytes(env: DocumentsBindings): number {
	const mb = Number(env.DOCS_MAX_MB);
	return env.DOCS_MAX_MB && Number.isFinite(mb) && mb > 0
		? Math.floor(mb * 1024 * 1024)
		: DEFAULT_MAX_DOCUMENT_BYTES;
}

const origin = (c: Ctx) => new URL(c.req.url).origin;
const docUrl = (c: Ctx, id: string) => `${origin(c)}/d/${id}`;

/**
 * Same rules as opens: send grace and owner window when the link names a message,
 * and the owner's recent IP for any direct fetch.
 */
async function documentSuppression(
	store: Store,
	config: Config,
	message: StoredMessage | null,
	facts: RequestFacts,
	at: number,
): Promise<IgnoreReason | undefined> {
	if (message)
		return suppressionReason(store, config, {
			message,
			type: "doc_view",
			facts,
			at,
		});
	if (
		facts.source === "direct" &&
		facts.ipHash &&
		(await store.ownerIpSeenSince(facts.ipHash, at - config.ownerIpMemoryMs))
	)
		return "owner";
	return undefined;
}

async function fileResponse(
	c: Ctx,
	doc: StoredDocument,
	disposition: "inline" | "attachment",
): Promise<Response> {
	const obj = await c.var.objects?.get(doc.r2Key);
	if (!obj) return c.html(DOC_NOT_FOUND_HTML, 404, NO_STORE_HEADERS);
	const kind = mustDownload(doc.mime) ? "attachment" : disposition;
	return new Response(obj.body, {
		headers: {
			...NO_STORE_HEADERS,
			"Content-Type": doc.mime,
			"Content-Length": String(obj.size),
			"Content-Disposition": contentDisposition(kind, doc.name),
			"X-Content-Type-Options": "nosniff",
			// If a file is ever opened directly, it gets no scripts and no origin.
			"Content-Security-Policy":
				"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
			"Referrer-Policy": "no-referrer",
		},
	});
}

/** Path params for both /d/:docId/... and /d/:docId/:messageId/...; null if malformed. */
function linkIds(c: Ctx): { docId: string; messageId?: string } | null {
	const docId = c.req.param("docId") ?? "";
	const messageId = c.req.param("messageId");
	if (!isValidId(docId)) return null;
	if (messageId !== undefined && !isValidId(messageId)) return null;
	return messageId ? { docId, messageId } : { docId };
}

/** Public routes, no auth: the viewer page, its file and its event beacon. */
export function viewerRoutes(): Hono<DocsEnv> {
	const r = new Hono<DocsEnv>();
	const notFound = (c: Ctx) =>
		c.html(DOC_NOT_FOUND_HTML, 404, NO_STORE_HEADERS);

	const page = async (c: Ctx) => {
		const ids = linkIds(c);
		if (!ids) return notFound(c);
		const doc = await c.var.docs.getDocument(ids.docId);
		if (!doc) return notFound(c);
		const prefix = ids.messageId
			? `/d/${doc.id}/${ids.messageId}`
			: `/d/${doc.id}`;
		const nonce = newId(22);
		const html = viewerHtml(
			{
				name: doc.name,
				size: doc.size,
				pdf: isPdf(doc.mime, doc.name),
				file: `${prefix}/file`,
				download: `${prefix}/file?download=1`,
				events: `${prefix}/events`,
			},
			nonce,
		);
		return c.html(html, 200, {
			...NO_STORE_HEADERS,
			"Content-Security-Policy": viewerCsp(nonce),
			"Referrer-Policy": "no-referrer",
			"X-Content-Type-Options": "nosniff",
			"X-Robots-Tag": "noindex, nofollow",
		});
	};

	const file = async (c: Ctx) => {
		const ids = linkIds(c);
		if (!ids) return notFound(c);
		const doc = await c.var.docs.getDocument(ids.docId);
		if (!doc) return notFound(c);
		return fileResponse(
			c,
			doc,
			c.req.query("download") ? "attachment" : "inline",
		);
	};

	const events = async (c: Ctx) => {
		const ids = linkIds(c);
		if (!ids) return c.json({ error: "not found" }, 404);
		const declared = Number(c.req.header("Content-Length") ?? 0);
		if (declared > MAX_VIEWER_BODY) return c.json({ error: "too large" }, 413);
		const text = await c.req.text();
		if (text.length > MAX_VIEWER_BODY)
			return c.json({ error: "too large" }, 413);
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			return c.json({ error: "invalid json" }, 400);
		}
		const parsed = parseViewerEvents(body);
		if (!parsed.ok) return c.json({ error: parsed.error }, 400);
		const { docs, store, config } = c.var;
		const doc = await docs.getDocument(ids.docId);
		if (!doc) return c.json({ error: "not found" }, 404);
		// A link naming an unknown (e.g. deleted) message still works, unattributed.
		const message = ids.messageId
			? await store.getMessage(ids.messageId)
			: null;
		const messageId = message?.id;
		const at = c.var.now();
		const facts = await describeRequest(c.req.raw, config, c.env.IP_SALT);

		// Later beacons inherit the classification of the view they belong to, so a
		// suppressed (owner) view never leaks dwell time once the owner window ends.
		let viewId: number | undefined;
		let source = facts.source;
		let ignored: IgnoreReason | undefined;
		let classified = false;
		if (parsed.value.viewId !== undefined) {
			const parent = await docs.getEvent(parsed.value.viewId);
			if (
				parent?.type === "view" &&
				parent.documentId === doc.id &&
				parent.messageId === messageId
			) {
				viewId = parent.id;
				source = parent.source;
				ignored = parent.ignored;
				classified = true;
			}
		}
		if (!classified && parsed.value.events.length > 0)
			ignored = await documentSuppression(store, config, message, facts, at);

		// The count is read from the file at upload. Only a PDF it couldn't be read from
		// takes the first viewer's report (any viewer can send anything here).
		if (parsed.value.pageCount && doc.pages === undefined)
			await docs.setPageCount(doc.id, parsed.value.pageCount);
		const pageLimit = doc.pages ?? parsed.value.pageCount ?? MAX_PAGES;

		const base = {
			documentId: doc.id,
			at,
			source,
			...(messageId ? { messageId } : {}),
			...(facts.device ? { device: facts.device } : {}),
			...(facts.location ? { location: facts.location } : {}),
			...(facts.ipHash ? { ipHash: facts.ipHash } : {}),
			...(ignored ? { ignored } : {}),
		};
		const res: ViewerEventsResponse = {};
		for (const e of parsed.value.events) {
			if (e.type === "view") {
				if (viewId !== undefined) continue; // one view per page load
				viewId = await docs.insertEvent({ ...base, type: "view" });
				res.viewId = viewId;
				// Mirror into the core feed so the owner is notified per recipient.
				if (messageId)
					await store.insertEvent({
						...base,
						messageId,
						type: "doc_view",
						documentName: doc.name,
					});
			} else if (e.type === "page") {
				if (e.page === undefined || e.page > pageLimit) continue;
				await docs.insertEvent({
					...base,
					type: "page",
					page: e.page,
					...(e.dwellMs !== undefined ? { dwellMs: e.dwellMs } : {}),
					...(viewId !== undefined ? { viewId } : {}),
				});
			} else {
				await docs.insertEvent({
					...base,
					type: "download",
					...(viewId !== undefined ? { viewId } : {}),
				});
			}
		}
		return c.json(res, 200, NO_STORE_HEADERS);
	};

	// Literal segments first: "file"/"events" are never valid message ids anyway.
	r.get("/:docId/file", file);
	r.post("/:docId/events", events);
	r.get("/:docId/:messageId/file", file);
	r.post("/:docId/:messageId/events", events);
	r.get("/:docId/:messageId", page);
	r.get("/:docId", page);
	return r;
}

function recipientQuery(c: Ctx): DocRecipientQuery | null {
	const { default: def, max } = PAGE_LIMITS.documentRecipients;
	const limit = intParam(c.req.query("limit"), def, 1, max);
	const raw = c.req.query("cursor");
	if (!raw) return { limit };
	const after = decodeCursor(raw, ["number", "number", "string"] as const);
	return after ? { limit, after } : null;
}

/** Per-recipient rows (SQL aggregate), with each page's messages joined in. */
async function recipientPage(
	c: Ctx,
	documentId: string,
	query: DocRecipientQuery,
): Promise<ListDocumentRecipientsResponse> {
	const rows = await c.var.docs.recipientRows(documentId, {
		...query,
		limit: query.limit + 1,
	});
	const page = pageOf(rows, query.limit, docRecipientKey);
	const messages = new Map(
		(
			await c.var.store.getMessagesByIds(
				page.items.flatMap((r) => (r.messageId ? [r.messageId] : [])),
			)
		).map((m) => [m.id, m]),
	);
	return {
		recipients: page.items.map((r) =>
			toRecipientStats(r, r.messageId ? messages.get(r.messageId) : undefined),
		),
		...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
	};
}

/** Owner API under /api/documents (bearer auth and CORS come from the core app). */
export function apiRoutes(): Hono<DocsEnv> {
	const r = new Hono<DocsEnv>();

	r.post("/", async (c) => {
		const objects = c.var.objects;
		if (!objects)
			return c.json(
				{ error: "document storage (DOCS bucket) is not configured" },
				503,
			);
		const max = maxUploadBytes(c.env);
		const declared = Number(c.req.header("Content-Length") ?? 0);
		if (declared > max)
			return c.json(
				{ error: `file is over the ${Math.round(max / 1048576)} MB limit` },
				413,
			);

		let data: ArrayBuffer;
		let name = c.req.query("name");
		let type = c.req.header("Content-Type");
		if ((type ?? "").startsWith("multipart/form-data")) {
			const form = await c.req.raw.formData().catch(() => null);
			const file = form?.get("file");
			if (!file || typeof file === "string")
				return c.json({ error: "multipart upload needs a 'file' field" }, 400);
			data = await file.arrayBuffer();
			name ??= file.name;
			type = file.type;
		} else {
			data = await c.req.arrayBuffer();
		}
		if (data.byteLength === 0) return c.json({ error: "empty file" }, 400);
		if (data.byteLength > max)
			return c.json(
				{ error: `file is over the ${Math.round(max / 1048576)} MB limit` },
				413,
			);

		const cleanName = cleanFileName(name);
		const doc: StoredDocument = {
			id: newId(),
			name: cleanName,
			mime: cleanMime(type, cleanName),
			size: data.byteLength,
			r2Key: "",
			createdAt: c.var.now(),
		};
		doc.r2Key = `documents/${doc.id}`;
		if (isPdf(doc.mime, doc.name)) {
			const pages = await pdfPageCount(data).catch(() => undefined);
			if (pages !== undefined && pages <= MAX_PAGES) doc.pages = pages;
		}
		await objects.put(doc.r2Key, data, doc.mime);
		await c.var.docs.createDocument(doc);
		const body: UploadDocumentResponse = {
			id: doc.id,
			name: doc.name,
			mime: doc.mime,
			size: doc.size,
			url: docUrl(c, doc.id),
		};
		return c.json(body, 201);
	});

	r.get("/", async (c) => {
		const { default: def, max } = PAGE_LIMITS.documents;
		const limit = intParam(c.req.query("limit"), def, 1, max);
		const cursorRaw = c.req.query("cursor");
		const cursor = decodeCursor(cursorRaw, ["number", "string"] as const);
		if (cursorRaw && !cursor) return c.json({ error: "invalid cursor" }, 400);
		const { docs } = c.var;
		const rows = await docs.listDocuments({
			limit: limit + 1,
			...(cursor ? { after: { createdAt: cursor[0], id: cursor[1] } } : {}),
		});
		const page = pageOf(rows, limit, (d) => [d.createdAt, d.id]);
		const stats = await docs.statsForDocuments(page.items.map((d) => d.id));
		const body: ListDocumentsResponse = {
			documents: page.items.map((d) =>
				toDocumentSummary(
					d,
					stats.get(d.id) ?? emptyDocumentStats(),
					docUrl(c, d.id),
				),
			),
			...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
		};
		return c.json(body);
	});

	r.post("/attach", async (c) => {
		const parsed = parseAttach(await readJson(c.req.raw));
		if (!parsed.ok) return c.json({ error: parsed.error }, 400);
		const { messageId, documentIds } = parsed.value;
		const { docs, store } = c.var;
		if (!(await store.getMessage(messageId)))
			return c.json({ error: "message not found" }, 404);
		const known: string[] = [];
		for (const id of documentIds)
			if (await docs.getDocument(id)) known.push(id);
		await docs.attachToMessage(messageId, known);
		return c.json({ ok: true, attached: known.length });
	});

	r.get("/:id", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const query = recipientQuery(c);
		if (!query) return c.json({ error: "invalid cursor" }, 400);
		const { docs } = c.var;
		const doc = await docs.getDocument(id);
		if (!doc) return c.json({ error: "not found" }, 404);
		const [stats, recipients, pages, events] = await Promise.all([
			docs.statsForDocuments([id]),
			recipientPage(c, id, query),
			docs.pageStats(id),
			docs.recentEvents(id, TIMELINE_LIMIT),
		]);
		const summary = toDocumentSummary(
			doc,
			stats.get(id) ?? emptyDocumentStats(),
			docUrl(c, doc.id),
		);
		return c.json(
			toDocumentDetail(summary, {
				recipients: recipients.recipients,
				...(recipients.nextCursor
					? { recipientsNextCursor: recipients.nextCursor }
					: {}),
				pages,
				events,
			}),
		);
	});

	r.get("/:id/recipients", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const query = recipientQuery(c);
		if (!query) return c.json({ error: "invalid cursor" }, 400);
		if (!(await c.var.docs.getDocument(id)))
			return c.json({ error: "not found" }, 404);
		return c.json(await recipientPage(c, id, query));
	});

	/** Owner preview: authenticated and never recorded as a view. */
	r.get("/:id/file", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const doc = await c.var.docs.getDocument(id);
		if (!doc) return c.json({ error: "not found" }, 404);
		return fileResponse(c, doc, "inline");
	});

	r.delete("/:id", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const doc = await c.var.docs.deleteDocument(id);
		if (!doc) return c.json({ error: "not found" }, 404);
		await c.var.objects?.delete([doc.r2Key]);
		return c.json({ ok: true });
	});

	return r;
}
