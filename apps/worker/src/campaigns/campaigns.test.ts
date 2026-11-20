import type {
	CampaignDetail,
	CampaignLeaseResponse,
	CreateCampaignRequest,
	ListCampaignsResponse,
	RecipientResultResponse,
} from "@bet/shared";
import { CAMPAIGN_API, DEFAULT_CAMPAIGN_SETTINGS } from "@bet/shared";
import { describe, expect, it } from "vitest";
import { runScheduled } from "../app";
import { modules } from "../modules";
import { GOOGLE_PROXY_UA, setup, T0 } from "../test-utils";
import { createCampaignsModule } from ".";
import { MemoryCampaignStore } from "./memory";

const CID = "camp000000000000000001";
const SEC = 1000;
const DAY = 86_400 * SEC;

function setupCampaigns(env: Parameters<typeof setup>[0] = {}) {
	const campaigns = new MemoryCampaignStore();
	const module = createCampaignsModule(() => campaigns);
	const all = [...modules.filter((m) => m.name !== "campaigns"), module];
	const s = setup(env, all);

	async function create(overrides: Partial<CreateCampaignRequest> = {}) {
		const body: CreateCampaignRequest = {
			id: CID,
			name: "Launch",
			provider: "gmail",
			subjectTemplate: "Hi {{first_name}}",
			bodyTemplate: "Hello {{name}}",
			settings: { ...DEFAULT_CAMPAIGN_SETTINGS },
			status: "sending",
			recipients: [
				{ email: "Ada@x.io", name: "Ada", fields: { first_name: "Ada" } },
				{ email: "bob@y.org", fields: { first_name: "Bob" } },
				{ email: "cy@z.net", fields: {}, skipReason: "Missing: first_name" },
			],
			...overrides,
		};
		return s.request(CAMPAIGN_API.campaigns, { json: body });
	}

	const get = async (id = CID) =>
		(await (
			await s.request(CAMPAIGN_API.campaign(id))
		).json()) as CampaignDetail;
	const list = async (q = "") =>
		(
			(await (
				await s.request(`${CAMPAIGN_API.campaigns}${q}`)
			).json()) as ListCampaignsResponse
		).campaigns;
	const result = (email: string, json: unknown) =>
		s.request(CAMPAIGN_API.recipientResult(CID, email), { json });
	const patch = (json: unknown, id = CID) =>
		s.request(CAMPAIGN_API.campaign(id), { method: "PATCH", json });

	/** What the extension does per recipient: claim, register the copy, mark sent, report. */
	async function sendTo(email: string, messageId: string, at: number) {
		s.clock.now = at;
		expect((await result(email, { state: "sending", messageId })).status).toBe(
			200,
		);
		await s.register({
			id: messageId,
			recipients: [{ email }],
			mode: "individual",
			groupId: CID,
		});
		await s.markSent(messageId, at);
		const res = await result(email, { state: "sent", messageId, sentAt: at });
		return (await res.json()) as RecipientResultResponse;
	}

	return { ...s, campaigns, create, get, list, result, patch, sendTo };
}

describe("campaign API", () => {
	it("creates a campaign with queued and skipped recipients", async () => {
		const s = setupCampaigns();
		const res = await s.create();
		expect(res.status).toBe(201);
		const d = (await res.json()) as CampaignDetail;
		expect(d).toMatchObject({
			id: CID,
			name: "Launch",
			status: "sending",
			bodyTemplate: "Hello {{name}}",
			stats: { total: 3, queued: 2, skipped: 1, sent: 0 },
		});
		expect(d.recipients.map((r) => [r.email, r.state, r.error])).toEqual([
			["ada@x.io", "queued", undefined],
			["bob@y.org", "queued", undefined],
			["cy@z.net", "skipped", "Missing: first_name"],
		]);
		expect((await s.create()).status).toBe(409);
	});

	it("validates input and requires auth", async () => {
		const s = setupCampaigns();
		expect((await s.create({ recipients: [] })).status).toBe(400);
		expect(
			(await s.create({ recipients: [{ email: "nope", fields: {} }] })).status,
		).toBe(400);
		expect((await s.create({ id: "../x" })).status).toBe(400);
		const res = await s.request(CAMPAIGN_API.campaigns, { auth: false });
		expect(res.status).toBe(401);
	});

	it("clamps settings", async () => {
		const s = setupCampaigns();
		await s.create({
			settings: {
				trackLinks: false,
				minDelaySec: 1,
				maxDelaySec: 99_999,
				perRunCap: 0,
				missingPolicy: "warn",
			},
		});
		expect((await s.get()).settings).toEqual({
			trackLinks: false,
			minDelaySec: 5,
			maxDelaySec: 3600,
			perRunCap: 1,
			missingPolicy: "warn",
		});
	});

	it("tracks sends per recipient and finishes when the queue is empty", async () => {
		const s = setupCampaigns();
		await s.create();
		const first = await s.sendTo(
			"ada@x.io",
			"msgA000000000000000001",
			T0 + SEC,
		);
		expect(first.campaignStatus).toBe("sending");
		// A recipient can only be claimed once.
		const again = await s.result("ada@x.io", { state: "sending" });
		expect(again.status).toBe(409);
		expect((await s.result("who@x.io", { state: "sent" })).status).toBe(404);
		const last = await s.sendTo(
			"BOB@y.org",
			"msgB000000000000000001",
			T0 + 30 * SEC,
		);
		expect(last.campaignStatus).toBe("done");
		const d = await s.get();
		expect(d.status).toBe("done");
		expect(d.lastSentAt).toBe(T0 + 30 * SEC);
		expect(d.recipients[0]).toMatchObject({
			state: "sent",
			messageId: "msgA000000000000000001",
			sentAt: T0 + SEC,
			status: "unopened",
		});
	});

	it("aggregates opens, clicks and machine opens through the groupId", async () => {
		const s = setupCampaigns();
		await s.create({
			recipients: [
				{ email: "a@x.io", fields: {} },
				{ email: "b@x.io", fields: {} },
				{ email: "c@x.io", fields: {} },
				{ email: "d@x.io", fields: {} },
			],
		});
		const ids = ["msgA", "msgB", "msgC", "msgD"].map((p) =>
			p.padEnd(22, "0"),
		) as [string, string, string, string];
		await s.sendTo("a@x.io", ids[0], T0);
		await s.sendTo("b@x.io", ids[1], T0);
		await s.sendTo("c@x.io", ids[2], T0);
		await s.sendTo("d@x.io", ids[3], T0);
		s.clock.now = T0 + 600 * SEC;
		await s.open(ids[0]); // human open
		await s.request(`/c/${ids[1]}/0`, { ua: "Mozilla/5.0 Chrome/130.0" });
		await s.open(ids[2], {
			ua: "Mozilla/5.0",
			cf: { asn: 714, asOrganization: "Apple Inc." },
			ip: "17.58.0.1",
		});
		const [summary] = await s.list();
		expect(summary?.stats).toMatchObject({
			sent: 4,
			opened: 2,
			clicked: 1,
			machineOnly: 1,
			unopened: 1,
		});
		const d = await s.get();
		expect(d.recipients.map((r) => r.status)).toEqual([
			"opened",
			"clicked",
			"machine_only",
			"unopened",
		]);
		// Proxy opens count as human (Gmail image proxy).
		await s.open(ids[3], { ua: GOOGLE_PROXY_UA });
		expect((await s.list())[0]?.stats.unopened).toBe(0);
	});

	it("ignores registered but unsent copies in stats", async () => {
		const s = setupCampaigns();
		await s.create();
		await s.register({
			id: "msgX000000000000000001",
			mode: "individual",
			groupId: CID,
		});
		expect((await s.list())[0]?.stats.unopened).toBe(0);
	});

	it("reconciles a claimed recipient whose copy was marked sent", async () => {
		const s = setupCampaigns();
		await s.create();
		await s.result("ada@x.io", {
			state: "sending",
			messageId: "msgA000000000000000001",
		});
		await s.register({
			id: "msgA000000000000000001",
			mode: "individual",
			groupId: CID,
		});
		await s.markSent("msgA000000000000000001", T0 + 5 * SEC);
		const d = await s.get();
		expect(d.recipients[0]).toMatchObject({
			state: "sent",
			sentAt: T0 + 5 * SEC,
		});
	});

	it("pauses, resumes, cancels, retries and filters by status", async () => {
		const s = setupCampaigns();
		await s.create({ status: "draft" });
		expect((await s.patch({ action: "pause" })).status).toBe(409);
		expect((await s.result("ada@x.io", { state: "sending" })).status).toBe(409);
		expect((await s.patch({ action: "start" })).status).toBe(200);
		const paused = await s.patch({
			action: "pause",
			reason: "Run cap of 50 reached",
		});
		expect(await paused.json()).toMatchObject({
			status: "paused",
			pauseReason: "Run cap of 50 reached",
		});
		expect((await s.list("?status=paused")).map((c) => c.id)).toEqual([CID]);
		expect(await s.list("?status=sending")).toEqual([]);
		await s.patch({ action: "resume" });
		await s.result("ada@x.io", { state: "failed", error: "compose failed" });
		await s.sendTo("bob@y.org", "msgB000000000000000001", T0);
		expect((await s.get()).status).toBe("done");
		const retried = (await (
			await s.patch({ action: "retry" })
		).json()) as CampaignDetail;
		expect(retried.status).toBe("sending");
		expect(retried.recipients[0]).toMatchObject({ state: "queued" });
		expect(retried.recipients[0]?.error).toBeUndefined();
		const cancelled = (await (
			await s.patch({ action: "cancel" })
		).json()) as CampaignDetail;
		expect(cancelled.status).toBe("cancelled");
		expect(cancelled.recipients.map((r) => r.state)).toEqual([
			"skipped",
			"sent",
			"skipped",
		]);
		expect((await s.patch({ action: "resume" })).status).toBe(409);
		expect((await s.patch({ action: "bogus" })).status).toBe(400);
	});

	it("gives the send lease to one runner at a time", async () => {
		const s = setupCampaigns();
		await s.create();
		const lease = (runnerId: string) =>
			s.request(`${CAMPAIGN_API.lease(CID)}`, {
				json: { runnerId, ttlMs: 60_000 },
			});
		const a = await lease("runnerA0000000000000001");
		expect(((await a.json()) as CampaignLeaseResponse).ok).toBe(true);
		expect((await lease("runnerB0000000000000001")).status).toBe(409);
		expect((await lease("runnerA0000000000000001")).status).toBe(200);
		s.clock.now = T0 + 61 * SEC;
		expect((await lease("runnerB0000000000000001")).status).toBe(200);
		await s.patch({ action: "pause" });
		expect((await lease("runnerB0000000000000001")).status).toBe(409);
	});

	it("deletes campaigns", async () => {
		const s = setupCampaigns();
		await s.create();
		const del = await s.request(CAMPAIGN_API.campaign(CID), {
			method: "DELETE",
		});
		expect(del.status).toBe(200);
		expect((await s.request(CAMPAIGN_API.campaign(CID))).status).toBe(404);
	});
});

describe("campaign retention", () => {
	it("purges campaigns not updated within RETENTION_DAYS", async () => {
		const s = setupCampaigns({ RETENTION_DAYS: "10" });
		await s.create();
		s.clock.now = T0 + 9 * DAY;
		await s.create({ id: "camp000000000000000002" });
		await runScheduled(
			s.env,
			"17 3 * * *",
			{ store: () => s.store, now: () => T0 + 11 * DAY },
			[createCampaignsModule(() => s.campaigns)],
		);
		expect([...s.campaigns.campaigns.keys()]).toEqual([
			"camp000000000000000002",
		]);
		expect(s.campaigns.recipientRows.has(CID)).toBe(false);
	});

	it("keeps everything when retention is disabled", async () => {
		const s = setupCampaigns({ RETENTION_DAYS: "0" });
		await s.create();
		await runScheduled(
			s.env,
			"17 3 * * *",
			{ store: () => s.store, now: () => T0 + 999 * DAY },
			[createCampaignsModule(() => s.campaigns)],
		);
		expect(s.campaigns.campaigns.size).toBe(1);
	});
});
