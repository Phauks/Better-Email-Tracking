import {
	type CampaignDetail,
	type CampaignLeaseResponse,
	type CampaignStatus,
	isValidId,
	type ListCampaignsResponse,
	type RecipientResultResponse,
} from "@bet/shared";
import { type Context, Hono } from "hono";
import { DAY, type Env } from "../env";
import { intParam } from "../lib/validate";
import { isRetentionRun } from "../services/retention";
import { groupByMessage } from "../services/summary";
import type { StoredMessage } from "../store/types";
import type { AppEnv, TrackerModule } from "../types";
import { D1CampaignStore } from "./d1";
import {
	campaignStats,
	toCampaignDetail,
	toCampaignRecipients,
	toCampaignSummary,
} from "./stats";
import type { CampaignStore, NewRecipient, StoredCampaign } from "./store";
import {
	parseCreateCampaign,
	parseLease,
	parseRecipientResult,
	parseUpdateCampaign,
} from "./validate";

type C = Context<AppEnv>;

async function readJson(req: Request): Promise<unknown> {
	try {
		return await req.json();
	} catch {
		return undefined;
	}
}

const STATUSES: CampaignStatus[] = [
	"draft",
	"sending",
	"paused",
	"done",
	"cancelled",
];

/** Mail merge campaigns. Sending happens in the extension; the Worker keeps the queue. */
export function createCampaignsModule(
	storeFor: (env: Env) => CampaignStore,
): TrackerModule {
	const routes = new Hono<AppEnv>();
	const cs = (c: C) => storeFor(c.env);

	async function summaries(c: C, campaigns: StoredCampaign[]) {
		const ids = campaigns.map((x) => x.id);
		const counts = await cs(c).counts(ids);
		const messages = ids.length
			? await c.var.store.getMessagesByGroupIds(ids)
			: [];
		const events = groupByMessage(
			await c.var.store.getEventsForMessages(messages.map((m) => m.id)),
		);
		return campaigns.map((x) => {
			const entry = counts.get(x.id);
			const states = entry?.states ?? {
				queued: 0,
				sending: 0,
				sent: 0,
				failed: 0,
				skipped: 0,
			};
			const group = messages.filter((m) => m.groupId === x.id);
			return {
				summary: toCampaignSummary(
					x,
					campaignStats(states, group, events),
					entry?.lastSentAt,
				),
				messages: group,
				events,
			};
		});
	}

	/** A copy whose send was confirmed (markSent) but whose result never arrived counts as sent. */
	async function reconcile(c: C, id: string, messages: StoredMessage[]) {
		const byId = new Map(messages.map((m) => [m.id, m]));
		const store = cs(c);
		let changed = false;
		for (const r of await store.recipients(id)) {
			const m = r.messageId ? byId.get(r.messageId) : undefined;
			if (r.state !== "sending" || m?.sentAt === undefined) continue;
			await store.updateRecipient(
				id,
				r.email,
				["sending"],
				{ state: "sent", sentAt: m.sentAt },
				c.var.now(),
			);
			changed = true;
		}
		if (changed) await finishIfComplete(c, id);
	}

	async function detail(c: C, id: string): Promise<CampaignDetail | null> {
		let campaign = await cs(c).get(id);
		if (!campaign) return null;
		const messages = await c.var.store.getMessagesByGroupIds([id]);
		await reconcile(c, id, messages);
		campaign = (await cs(c).get(id)) ?? campaign;
		const [first] = await summaries(c, [campaign]);
		if (!first) return null;
		const recipients = toCampaignRecipients(
			await cs(c).recipients(id),
			new Map(first.messages.map((m) => [m.id, m])),
			first.events,
		);
		return toCampaignDetail(first.summary, campaign, recipients);
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
		const limit = intParam(c.req.query("limit"), 50, 1, 200);
		const statusRaw = c.req.query("status") as CampaignStatus | undefined;
		const status =
			statusRaw && STATUSES.includes(statusRaw) ? statusRaw : undefined;
		const campaigns = await cs(c).list(limit, status);
		const body: ListCampaignsResponse = {
			campaigns: (await summaries(c, campaigns)).map((s) => s.summary),
		};
		return c.json(body);
	});

	routes.get("/:id", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const body = await detail(c, id);
		if (!body) return c.json({ error: "not found" }, 404);
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
		if (!(await cs(c).delete(id))) return c.json({ error: "not found" }, 404);
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
		if (r.state !== "sending") await finishIfComplete(c, id);
		const body: RecipientResultResponse = {
			ok: true,
			campaignStatus: (await store.get(id))?.status ?? campaign.status,
		};
		return c.json(body);
	});

	return {
		name: "campaigns",
		register(app) {
			app.route("/api/campaigns", routes);
		},
		async scheduled({ env, config, now, cron }) {
			if (config.retentionDays <= 0 || !isRetentionRun(cron, now)) return;
			const purged = await storeFor(env).purgeBefore(
				now - config.retentionDays * DAY,
			);
			console.log("campaign retention purge", { campaigns: purged });
		},
	};
}

export const campaignsModule = createCampaignsModule(
	(env) => new D1CampaignStore(env.DB),
);
