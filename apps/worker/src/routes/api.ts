import {
	type FeedResponse,
	isValidId,
	type ListMessagesResponse,
	type MessageDetail,
	type ThreadStatusRequest,
	type ThreadStatusResponse,
} from "@bet/shared";
import { Hono } from "hono";
import { ipHashOf } from "../lib/request";
import {
	cleanThreadIds,
	intParam,
	parseMarkSent,
	parseOwnerViews,
	parseRegister,
} from "../lib/validate";
import {
	groupByMessage,
	threadStatus,
	toFeedEvent,
	toSummary,
	toTrackingEvent,
} from "../services/summary";
import type { StoredMessage } from "../store/types";
import type { AppEnv, TrackerModule } from "../types";

/** Mounted at /api; CORS and bearer auth are applied by the core app. */
export const apiRoutes = new Hono<AppEnv>();

async function readJson(req: Request): Promise<unknown> {
	try {
		return await req.json();
	} catch {
		return undefined;
	}
}

apiRoutes.get("/health", (c) => c.json({ ok: true }));

apiRoutes.post("/messages", async (c) => {
	const parsed = parseRegister(await readJson(c.req.raw));
	if (!parsed.ok) return c.json({ error: parsed.error }, 400);
	const { id, provider, subject, recipients, links, mode, groupId } =
		parsed.value;
	await c.var.store.upsertMessage({
		id,
		provider,
		subject,
		recipients,
		mode,
		...(groupId ? { groupId } : {}),
		trackOpens: parsed.value.trackOpens,
		trackLinks: parsed.value.trackLinks,
		links,
		createdAt: c.var.now(),
	});
	return c.json({ ok: true, id }, 201);
});

apiRoutes.post("/messages/:id/sent", async (c) => {
	const id = c.req.param("id");
	if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
	const parsed = parseMarkSent(await readJson(c.req.raw));
	if (!parsed.ok) return c.json({ error: parsed.error }, 400);
	const found = await c.var.store.markSent(id, parsed.value);
	if (!found) return c.json({ error: "not found" }, 404);
	return c.json({ ok: true });
});

apiRoutes.get("/messages", async (c) => {
	const limit = intParam(c.req.query("limit"), 50, 1, 200);
	const beforeRaw = c.req.query("before");
	const before = beforeRaw ? Number(beforeRaw) : undefined;
	const groupId = c.req.query("groupId");
	const q = c.req.query("q")?.trim().slice(0, 200);
	const { store } = c.var;
	const messages = await store.listMessages({
		limit,
		...(before !== undefined && Number.isFinite(before) ? { before } : {}),
		...(groupId ? { groupId } : {}),
		...(q ? { q } : {}),
	});
	const events = groupByMessage(
		await store.getEventsForMessages(messages.map((m) => m.id)),
	);
	const body: ListMessagesResponse = {
		messages: messages.map((m) => toSummary(m, events.get(m.id) ?? [])),
	};
	return c.json(body);
});

apiRoutes.get("/messages/:id", async (c) => {
	const id = c.req.param("id");
	if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
	const { store } = c.var;
	const message = await store.getMessage(id);
	if (!message) return c.json({ error: "not found" }, 404);
	const [links, events] = await Promise.all([
		store.getLinks(id),
		store.getEventsForMessages([id]),
	]);
	const body: MessageDetail = {
		...toSummary(message, events),
		links,
		events: events.map(toTrackingEvent),
	};
	return c.json(body);
});

apiRoutes.delete("/messages/:id", async (c) => {
	const id = c.req.param("id");
	if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
	const deleted = await c.var.store.deleteMessage(id);
	if (!deleted) return c.json({ error: "not found" }, 404);
	return c.json({ ok: true });
});

/** New counted events. `since` omitted = the most recent `limit` events. */
apiRoutes.get("/feed", async (c) => {
	const limit = intParam(c.req.query("limit"), 50, 1, 200);
	const sinceRaw = c.req.query("since");
	const since = sinceRaw
		? intParam(sinceRaw, 0, 0, Number.MAX_SAFE_INTEGER)
		: undefined;
	const { store } = c.var;
	const events =
		since === undefined
			? await store.getLatestFeedEvents(limit)
			: await store.getFeedEventsAfter(since, limit);
	const messages = new Map<string, StoredMessage>();
	for (const m of await store.getMessagesByIds([
		...new Set(events.map((e) => e.messageId)),
	]))
		messages.set(m.id, m);
	const links = new Map<string, string[]>();
	for (const id of new Set(
		events.filter((e) => e.type === "click").map((e) => e.messageId),
	))
		links.set(id, await store.getLinks(id));
	const body: FeedResponse = {
		events: events.flatMap((e) => {
			const m = messages.get(e.messageId);
			return m ? [toFeedEvent(e, m, links)] : [];
		}),
		cursor: events.reduce((max, e) => Math.max(max, e.id), since ?? 0),
	};
	return c.json(body);
});

async function threadStatuses(
	c: { var: AppEnv["Variables"] },
	threadIds: string[],
): Promise<ThreadStatusResponse> {
	const { store } = c.var;
	const threads: ThreadStatusResponse["threads"] = {};
	if (threadIds.length === 0) return { threads };
	const inThreads = await store.getMessagesByThreadIds(threadIds);
	const groupIds = [
		...new Set(
			inThreads
				.filter((m) => m.mode === "individual" && m.groupId)
				.map((m) => m.groupId as string),
		),
	];
	const inGroups = groupIds.length
		? await store.getMessagesByGroupIds(groupIds)
		: [];
	const events = groupByMessage(
		await store.getEventsForMessages([
			...inThreads.map((m) => m.id),
			...inGroups.map((m) => m.id),
		]),
	);
	for (const threadId of threadIds) {
		const msgs = inThreads.filter((m) => m.providerThreadId === threadId);
		if (msgs.length > 0)
			threads[threadId] = threadStatus(msgs, inGroups, events);
	}
	return { threads };
}

apiRoutes.get("/thread-status", async (c) => {
	const ids = cleanThreadIds((c.req.query("ids") ?? "").split(","));
	return c.json(await threadStatuses(c, ids));
});

/** Same as GET, for long id lists: body ThreadStatusRequest. */
apiRoutes.post("/thread-status", async (c) => {
	const body = (await readJson(c.req.raw)) as
		| Partial<ThreadStatusRequest>
		| undefined;
	const ids = Array.isArray(body?.threadIds)
		? cleanThreadIds(body.threadIds)
		: [];
	return c.json(await threadStatuses(c, ids));
});

/** The owner is looking at these messages: suppress opens for a short window. */
apiRoutes.post("/owner-views", async (c) => {
	const parsed = parseOwnerViews(await readJson(c.req.raw));
	if (!parsed.ok) return c.json({ error: parsed.error }, 400);
	const ipHash = await ipHashOf(c.req.raw, c.env.IP_SALT);
	const now = c.var.now();
	await c.var.store.recordOwnerViews(parsed.value.messageIds, now, ipHash);
	// The proxy fetch often lands a moment before this report arrives.
	await c.var.store.ignoreOpensSince(
		parsed.value.messageIds,
		now - c.var.config.ownerWindowMs,
		"owner",
	);
	return c.json({ ok: true });
});

export const apiModule: TrackerModule = {
	name: "api",
	register(app) {
		app.route("/api", apiRoutes);
	},
};
