import {
	type CampaignDetail,
	type CampaignFollowUp,
	type CampaignFollowUpActionResponse,
	type CampaignLeaseResponse,
	type CampaignStatus,
	decodeCursor,
	isValidId,
	type ListCampaignsResponse,
	type ListRecipientsResponse,
	PAGE_LIMITS,
	pageOf,
	type RecipientResultResponse,
} from "@bet/shared";
import { type Context, Hono } from "hono";
import { intParam, readJson } from "../../lib/parse";
import type { AppEnv } from "../../types";
import type { CampaignsDeps } from ".";
import {
	campaignStats,
	toCampaignDetail,
	toCampaignRecipients,
	toCampaignSummary,
} from "./stats";
import {
	emptyCounts,
	type NewRecipient,
	type RecipientPageQuery,
	type StoredCampaign,
	type StoredRecipient,
} from "./store/types";
import {
	parseCreateCampaign,
	parseFollowUpAction,
	parseLease,
	parseRecipientQuery,
	parseRecipientResult,
	parseUpdateCampaign,
} from "./validate";

type C = Context<AppEnv>;

const STATUSES: CampaignStatus[] = [
	"draft",
	"sending",
	"paused",
	"done",
	"cancelled",
];

const FOLLOW_UP_STATE = {
	pause: "paused",
	resume: "active",
	cancel: "cancelled",
} as const;

/** /api/campaigns (bearer auth and CORS come from the core app). */
export function createCampaignRoutes(deps: CampaignsDeps): Hono<AppEnv> {
	const routes = new Hono<AppEnv>();
	const cs = (c: C) => deps.store(c.env);
	const followUps = (c: C) => deps.followUps(c.env, c.var.store);

	/** Queue counts plus engagement, both SQL aggregates (no per-event loading). */
	async function summaries(c: C, campaigns: StoredCampaign[]) {
		const ids = campaigns.map((x) => x.id);
		const [counts, engagement] = await Promise.all([
			cs(c).counts(ids),
			ids.length ? c.var.store.groupEngagement(ids) : new Map(),
		]);
		return campaigns.map((x) => {
			const entry = counts.get(x.id);
			return toCampaignSummary(
				x,
				campaignStats(entry?.states ?? emptyCounts(), engagement.get(x.id)),
				entry?.lastSentAt,
			);
		});
	}

	/**
	 * Starts the follow-up of a copy that was just confirmed sent, when the campaign has
	 * a policy. Idempotent (the service keeps an existing sequence) and never fails the
	 * caller: a copy that can't get one (no mailbox connected, no thread) is logged.
	 */
	async function startFollowUp(
		c: C,
		campaign: StoredCampaign,
		r: StoredRecipient,
		providerThreadId?: string,
	): Promise<void> {
		const policy = campaign.followUp;
		if (!policy || policy.state === "cancelled" || !r.messageId) return;
		try {
			const res = await followUps(c).start({
				messageId: r.messageId,
				...(providerThreadId ? { providerThreadId } : {}),
				spec: {
					steps: policy.steps,
					stopOnOpen: policy.stopOnOpen,
					...(policy.sendWindow ? { sendWindow: policy.sendWindow } : {}),
				},
				paused: policy.state === "paused",
				fields: r.fields,
				trackerBase: new URL(c.req.url).origin,
				now: c.var.now(),
			});
			if (res.status === "skipped")
				console.warn("campaign follow-up skipped", campaign.id, res.reason);
		} catch (err) {
			console.error("campaign follow-up failed", campaign.id, err);
		}
	}

	/**
	 * A copy whose send was confirmed (markSent) but whose result never arrived counts
	 * as sent. Only claimed ("sending") recipients are read, so this stays small.
	 */
	async function reconcile(c: C, campaign: StoredCampaign): Promise<boolean> {
		const store = cs(c);
		const stale = await store.recipients(campaign.id, {
			states: ["sending"],
			limit: PAGE_LIMITS.recipients.max,
		});
		if (stale.length === 0) return false;
		const messages = new Map(
			(
				await c.var.store.getMessagesByIds(
					stale.flatMap((r) => (r.messageId ? [r.messageId] : [])),
				)
			).map((m) => [m.id, m]),
		);
		let changed = false;
		for (const r of stale) {
			const m = r.messageId ? messages.get(r.messageId) : undefined;
			if (m?.sentAt === undefined) continue;
			const ok = await store.updateRecipient(
				campaign.id,
				r.email,
				["sending"],
				{ state: "sent", sentAt: m.sentAt },
				c.var.now(),
			);
			if (!ok) continue;
			changed = true;
			await startFollowUp(c, campaign, r);
		}
		if (changed) await finishIfComplete(c, campaign.id);
		return changed;
	}

	/** One page of recipients with tracking status and follow-up state. */
	async function recipientPage(
		c: C,
		campaign: StoredCampaign,
		query: RecipientPageQuery,
	): Promise<ListRecipientsResponse> {
		const rows = await cs(c).recipients(campaign.id, {
			...query,
			limit: query.limit + 1,
		});
		const page = pageOf(rows, query.limit, (r) => [r.position]);
		const ids = page.items.flatMap((r) => (r.messageId ? [r.messageId] : []));
		const { store } = c.var;
		const [messages, counts, fu] = await Promise.all([
			store.getMessagesByIds(ids),
			store.countsForMessages(ids),
			campaign.followUp
				? followUps(c).forMessages(ids)
				: Promise.resolve(undefined),
		]);
		return {
			recipients: toCampaignRecipients(
				page.items,
				new Map(messages.map((m) => [m.id, m])),
				counts,
				fu,
			),
			...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
		};
	}

	async function detail(
		c: C,
		id: string,
		query: RecipientPageQuery = { limit: PAGE_LIMITS.recipients.default },
	): Promise<CampaignDetail | null> {
		let campaign = await cs(c).get(id);
		if (!campaign) return null;
		if (await reconcile(c, campaign))
			campaign = (await cs(c).get(id)) ?? campaign;
		const [[summary], page, followUpStats] = await Promise.all([
			summaries(c, [campaign]),
			recipientPage(c, campaign, query),
			campaign.followUp
				? followUps(c).groupStats(id)
				: Promise.resolve(undefined),
		]);
		if (!summary) return null;
		return toCampaignDetail(summary, campaign, page.recipients, {
			...(page.nextCursor ? { recipientsNextCursor: page.nextCursor } : {}),
			...(followUpStats ? { followUpStats } : {}),
		});
	}

	/** Marks a sending/paused campaign done once nothing is queued or in flight. */
	async function finishIfComplete(c: C, id: string): Promise<void> {
		const states = (await cs(c).counts([id])).get(id)?.states;
		if (states && states.queued + states.sending === 0)
			await cs(c).setStatus(id, "done", ["sending", "paused"], c.var.now());
	}

	routes.post("/", async (c) => {
		const parsed = parseCreateCampaign(await readJson(c.req.raw));
		if (!parsed.ok) return c.json({ error: parsed.error }, 400);
		const req = parsed.value;
		if (await cs(c).get(req.id)) return c.json({ error: "exists" }, 409);
		const now = c.var.now();
		const recipients: NewRecipient[] = req.recipients.map((r, position) => {
			const row: NewRecipient = {
				position,
				email: r.email.toLowerCase(),
				fields: r.fields,
				state: r.skipReason ? "skipped" : "queued",
				updatedAt: now,
			};
			if (r.name) row.name = r.name;
			if (r.skipReason) row.error = r.skipReason;
			return row;
		});
		await cs(c).create(
			{
				id: req.id,
				name: req.name,
				provider: req.provider,
				subjectTemplate: req.subjectTemplate,
				bodyTemplate: req.bodyTemplate,
				status: req.status,
				settings: req.settings,
				...(req.followUp
					? { followUp: { ...req.followUp, state: "active" as const } }
					: {}),
				total: recipients.length,
				createdAt: now,
				updatedAt: now,
			},
			recipients,
		);
		if (req.status === "sending") await finishIfComplete(c, req.id);
		return c.json(await detail(c, req.id), 201);
	});

	routes.get("/", async (c) => {
		const { default: def, max } = PAGE_LIMITS.campaigns;
		const limit = intParam(c.req.query("limit"), def, 1, max);
		const cursorRaw = c.req.query("cursor");
		const cursor = decodeCursor(cursorRaw, ["number", "string"] as const);
		if (cursorRaw && !cursor) return c.json({ error: "invalid cursor" }, 400);
		const statusRaw = c.req.query("status") as CampaignStatus | undefined;
		const status =
			statusRaw && STATUSES.includes(statusRaw) ? statusRaw : undefined;
		const rows = await cs(c).list({
			limit: limit + 1,
			...(status ? { status } : {}),
			...(cursor ? { after: { createdAt: cursor[0], id: cursor[1] } } : {}),
		});
		const page = pageOf(rows, limit, (x) => [x.createdAt, x.id]);
		const body: ListCampaignsResponse = {
			campaigns: await summaries(c, page.items),
			...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
		};
		return c.json(body);
	});

	routes.get("/:id", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const query = parseRecipientQuery((k) => c.req.query(k));
		if (!query.ok) return c.json({ error: query.error }, 400);
		const body = await detail(c, id, query.value);
		if (!body) return c.json({ error: "not found" }, 404);
		return c.json(body);
	});

	routes.get("/:id/recipients", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const query = parseRecipientQuery((k) => c.req.query(k));
		if (!query.ok) return c.json({ error: query.error }, 400);
		const campaign = await cs(c).get(id);
		if (!campaign) return c.json({ error: "not found" }, 404);
		return c.json(await recipientPage(c, campaign, query.value));
	});

	/** Pause, resume or cancel every follow-up of the campaign, and new copies' too. */
	routes.post("/:id/follow-ups", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const parsed = parseFollowUpAction(await readJson(c.req.raw));
		if (!parsed.ok) return c.json({ error: parsed.error }, 400);
		const campaign = await cs(c).get(id);
		if (!campaign) return c.json({ error: "not found" }, 404);
		if (!campaign.followUp)
			return c.json({ error: "this campaign has no follow-ups" }, 409);
		if (campaign.followUp.state === "cancelled")
			return c.json({ error: "follow-ups were cancelled" }, 409);
		const action = parsed.value;
		const now = c.var.now();
		const changed = await followUps(c).updateGroup(id, action, now);
		const followUp: CampaignFollowUp = {
			...campaign.followUp,
			state: FOLLOW_UP_STATE[action],
		};
		await cs(c).setFollowUp(id, followUp, now);
		const body: CampaignFollowUpActionResponse = { changed, followUp };
		return c.json(body);
	});

	routes.patch("/:id", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const parsed = parseUpdateCampaign(await readJson(c.req.raw));
		if (!parsed.ok) return c.json({ error: parsed.error }, 400);
		const store = cs(c);
		const campaign = await store.get(id);
		if (!campaign) return c.json({ error: "not found" }, 404);
		const now = c.var.now();
		const { action, reason } = parsed.value;
		let ok = false;
		switch (action) {
			case "start":
				ok = await store.setStatus(id, "sending", ["draft"], now);
				break;
			case "resume":
				ok = await store.setStatus(id, "sending", ["paused"], now);
				break;
			case "pause":
				ok = await store.setStatus(id, "paused", ["sending"], now, reason);
				break;
			case "cancel":
				ok = await store.setStatus(
					id,
					"cancelled",
					["draft", "sending", "paused"],
					now,
				);
				if (ok)
					await store.moveRecipients(
						id,
						["queued"],
						"skipped",
						now,
						"Cancelled",
					);
				break;
			case "retry": {
				if (campaign.status === "cancelled" || campaign.status === "draft")
					break;
				const moved = await store.moveRecipients(id, ["failed"], "queued", now);
				ok =
					moved > 0 &&
					(campaign.status === "sending" ||
						(await store.setStatus(id, "sending", ["paused", "done"], now)));
				break;
			}
		}
		if (!ok)
			return c.json(
				{ error: `cannot ${action} a ${campaign.status} campaign` },
				409,
			);
		if (action === "start" || action === "resume")
			await finishIfComplete(c, id);
		return c.json(await detail(c, id));
	});

	routes.delete("/:id", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const campaign = await cs(c).get(id);
		if (!campaign || !(await cs(c).delete(id)))
			return c.json({ error: "not found" }, 404);
		// Deleting a campaign must not leave its follow-ups sending.
		if (campaign.followUp)
			await followUps(c).updateGroup(id, "cancel", c.var.now());
		return c.json({ ok: true });
	});

	routes.post("/:id/lease", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const parsed = parseLease(await readJson(c.req.raw));
		if (!parsed.ok) return c.json({ error: parsed.error }, 400);
		const campaign = await cs(c).get(id);
		if (!campaign) return c.json({ error: "not found" }, 404);
		const no: CampaignLeaseResponse = { ok: false };
		if (campaign.status !== "sending") return c.json(no, 409);
		const now = c.var.now();
		const until = now + parsed.value.ttlMs;
		const ok = await cs(c).acquireLease(id, parsed.value.runnerId, until, now);
		const body: CampaignLeaseResponse = ok ? { ok, leaseUntil: until } : no;
		return c.json(body, ok ? 200 : 409);
	});

	routes.post("/:id/recipients/:email/result", async (c) => {
		const id = c.req.param("id");
		const email = (c.req.param("email") ?? "").toLowerCase();
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const parsed = parseRecipientResult(await readJson(c.req.raw));
		if (!parsed.ok) return c.json({ error: parsed.error }, 400);
		const store = cs(c);
		const campaign = await store.get(id);
		if (!campaign) return c.json({ error: "not found" }, 404);
		const now = c.var.now();
		const r = parsed.value;
		if (r.state === "sending" && campaign.status !== "sending")
			return c.json({ error: `campaign is ${campaign.status}` }, 409);
		const ok = await store.updateRecipient(
			id,
			email,
			r.state === "sending" ? ["queued"] : ["queued", "sending"],
			{
				state: r.state,
				...(r.messageId ? { messageId: r.messageId } : {}),
				error: r.error ?? null,
				...(r.state === "sent" ? { sentAt: r.sentAt ?? now } : {}),
			},
			now,
		);
		if (!ok) {
			const exists = await store.getRecipient(id, email);
			return c.json(
				{ error: exists ? `recipient is ${exists.state}` : "not found" },
				exists ? 409 : 404,
			);
		}
		if (r.state === "sent") {
			const sent = await store.getRecipient(id, email);
			if (sent) await startFollowUp(c, campaign, sent, r.providerThreadId);
		}
		if (r.state !== "sending") await finishIfComplete(c, id);
		const body: RecipientResultResponse = {
			ok: true,
			campaignStatus: (await store.get(id))?.status ?? campaign.status,
		};
		return c.json(body);
	});

	return routes;
}
