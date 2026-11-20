import type {
	CampaignDetail,
	CampaignFollowUpActionResponse,
	CampaignFollowUpPolicy,
	CreateCampaignRequest,
	ListMessagesResponse,
	ListNudgesResponse,
	ListRecipientsResponse,
} from "@bet/shared";
import { CAMPAIGN_API, DEFAULT_CAMPAIGN_SETTINGS } from "@bet/shared";
import { describe, expect, it } from "vitest";
import { runScheduled } from "../../app";
import { FakeMailbox } from "../../connectors/fake";
import { modules as defaultModules } from "../../modules";
import { setup, T0 } from "../../test-utils";
import { createNudgesModule } from "../nudges";
import { createFollowUpService } from "../nudges/public";
import { MemoryNudgeStore } from "../nudges/store/memory";
import { createCampaignsModule } from "./index";
import { MemoryCampaignStore } from "./store/memory";

const CID = "camp000000000000000001";
const DAY = 86_400_000;

const POLICY: CampaignFollowUpPolicy = {
	steps: [
		{
			afterDays: 3,
			html: "<p>Hi {{firstName|there}}, any news from {{company|your team}}?</p>",
		},
		{ afterDays: 4, html: "<p>Last nudge, {{first_name}}.</p>" },
	],
	stopOnOpen: false,
};

/** Campaigns + nudges sharing one memory nudge store, and a fake Gmail. */
function followUpSetup() {
	const campaigns = new MemoryCampaignStore();
	const nudges = new MemoryNudgeStore();
	const time = { now: T0 };
	const mailbox = new FakeMailbox("me@example.com", () => time.now);
	const mods = [
		...defaultModules.filter(
			(m) => m.name !== "campaigns" && m.name !== "nudges",
		),
		createCampaignsModule({
			store: () => campaigns,
			followUps: (_env, core) => createFollowUpService({ nudges, store: core }),
		}),
		createNudgesModule({
			store: () => nudges,
			resolveConnector: async () => mailbox,
			fetch: async () => new Response("unexpected", { status: 500 }),
		}),
	];
	const s = setup({}, mods);
	const connect = () =>
		nudges.saveConnector({
			kind: "google",
			email: "me@example.com",
			refreshTokenEnc: "sealed",
			scopes: "",
			connectedAt: T0,
		});
	const run = async (at: number) => {
		time.now = at;
		s.clock.now = at;
		await runScheduled(
			s.env,
			"*/15 * * * *",
			{ store: () => s.store, now: () => at },
			mods,
		);
	};

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
				{
					email: "Ada@x.io",
					name: "Ada Lovelace",
					fields: { first_name: "Ada", company: "Engines & Co" },
				},
				{ email: "bob@y.org", fields: { first_name: "Bob" } },
			],
			followUp: POLICY,
			...overrides,
		};
		const res = await s.request(CAMPAIGN_API.campaigns, { json: body });
		expect(res.status).toBe(201);
		return (await res.json()) as CampaignDetail;
	}

	const result = (email: string, json: unknown) =>
		s.request(CAMPAIGN_API.recipientResult(CID, email), { json });
	const get = async (q = "") =>
		(await (
			await s.request(`${CAMPAIGN_API.campaign(CID)}${q}`)
		).json()) as CampaignDetail;

	/** What the extension does per copy: claim, register, mark sent (with its thread), report. */
	async function sendTo(
		email: string,
		messageId: string,
		opts: { thread?: string; markThread?: boolean; report?: boolean } = {},
	) {
		const thread = opts.thread ?? `thread-${messageId}`;
		expect((await result(email, { state: "sending", messageId })).status).toBe(
			200,
		);
		await s.register({
			id: messageId,
			recipients: [{ email }],
			mode: "individual",
			groupId: CID,
		});
		await s.markSent(
			messageId,
			s.clock.now,
			opts.markThread === false ? undefined : thread,
		);
		mailbox.addMessage(thread, {
			from: "me@example.com",
			at: s.clock.now,
			messageIdHeader: `<${messageId}@mail>`,
		});
		if (opts.report === false) return;
		const res = await result(email, {
			state: "sent",
			messageId,
			sentAt: s.clock.now,
			providerThreadId: thread,
		});
		expect(res.status).toBe(200);
	}

	return {
		s,
		campaigns,
		nudges,
		mailbox,
		connect,
		run,
		create,
		result,
		get,
		sendTo,
	};
}

const M1 = "mmsg000000000000000001";
const M2 = "mmsg000000000000000002";

describe("campaign follow-ups", () => {
	it("starts a sequence per sent copy, rendering merge fields in its nudges", async () => {
		const t = followUpSetup();
		await t.connect();
		const created = await t.create();
		expect(created.followUp).toEqual({ ...POLICY, state: "active" });

		await t.sendTo("ada@x.io", M1);
		expect(t.nudges.sequences.size).toBe(1);
		const [seq] = [...t.nudges.sequences.values()];
		expect(seq).toMatchObject({
			messageId: M1,
			groupId: CID,
			state: "active",
			providerThreadId: `thread-${M1}`,
			nextAt: T0 + 3 * DAY,
			fields: { first_name: "Ada", company: "Engines & Co" },
		});

		// A repeated report is refused and never creates a second sequence.
		expect(
			(
				await t.result("ada@x.io", {
					state: "sent",
					messageId: M1,
					providerThreadId: `thread-${M1}`,
				})
			).status,
		).toBe(409);
		expect(t.nudges.sequences.size).toBe(1);

		await t.run(T0 + 3 * DAY + 1000);
		expect(t.mailbox.sent).toHaveLength(1);
		const reply = t.mailbox.sent[0]?.reply;
		expect(reply?.to).toEqual([{ email: "ada@x.io" }]);
		expect(reply?.html).toContain("Hi Ada, any news from Engines &amp; Co?");

		// The nudge is a tracked message of the campaign's group, but not an email:
		// it isn't listed and doesn't change the campaign's stats.
		const listed = (await (
			await t.s.request("/api/messages")
		).json()) as ListMessagesResponse;
		expect(listed.messages.map((m) => m.id)).toEqual([M1]);
		const detail = await t.get();
		expect(detail.stats).toMatchObject({ sent: 1, unopened: 1 });
		const ada = detail.recipients.find((r) => r.email === "ada@x.io");
		expect(ada?.followUp).toMatchObject({
			state: "active",
			sent: 1,
			steps: 2,
		});
		expect(detail.followUpStats).toEqual({
			sequences: 1,
			states: { active: 1 },
			nudgesSent: 1,
		});

		// Someone replies: the sequence stops and the recipient row says so.
		t.mailbox.addMessage(`thread-${M1}`, {
			from: "ada@x.io",
			at: T0 + 4 * DAY,
			messageIdHeader: "<r@x>",
		});
		await t.run(T0 + 7 * DAY + 1000);
		expect(t.mailbox.sent).toHaveLength(1);
		expect(
			(await t.get()).recipients.find((r) => r.email === "ada@x.io")?.followUp
				?.state,
		).toBe("replied");
	});

	it("uses the reported thread id when markSent lost it, and the reconcile path once", async () => {
		const t = followUpSetup();
		await t.connect();
		await t.create();
		await t.sendTo("ada@x.io", M1, { markThread: false });
		const [seq] = [...t.nudges.sequences.values()];
		expect(seq?.providerThreadId).toBe(`thread-${M1}`);

		// Bob's result never arrives; reading the campaign reconciles it as sent.
		await t.sendTo("bob@y.org", M2, { report: false });
		expect(t.nudges.sequences.size).toBe(1);
		await t.get();
		await t.get();
		expect(t.nudges.sequences.size).toBe(2);
		const bob = [...t.nudges.sequences.values()].find(
			(x) => x.messageId === M2,
		);
		expect(bob?.fields).toEqual({ first_name: "Bob" });
	});

	it("does nothing without a policy or a connected mailbox", async () => {
		const t = followUpSetup();
		await t.connect();
		await t.create({ followUp: undefined });
		await t.sendTo("ada@x.io", M1);
		expect(t.nudges.sequences.size).toBe(0);
		const detail = await t.get();
		expect(detail.followUp).toBeUndefined();
		expect(detail.followUpStats).toBeUndefined();

		const u = followUpSetup(); // not connected
		await u.create();
		await u.sendTo("ada@x.io", M1);
		expect(u.nudges.sequences.size).toBe(0);
		expect(
			(await u.get()).recipients.find((r) => r.email === "ada@x.io")?.state,
		).toBe("sent");
	});

	it("rejects an invalid policy", async () => {
		const t = followUpSetup();
		const res = await t.s.request(CAMPAIGN_API.campaigns, {
			json: {
				id: CID,
				name: "x",
				provider: "gmail",
				subjectTemplate: "s",
				bodyTemplate: "b",
				settings: DEFAULT_CAMPAIGN_SETTINGS,
				status: "draft",
				recipients: [{ email: "a@x.io", fields: {} }],
				followUp: { steps: [{ afterDays: 500, html: "x" }] },
			},
		});
		expect(res.status).toBe(400);
	});

	it("pauses, resumes and cancels every follow-up of the campaign", async () => {
		const t = followUpSetup();
		await t.connect();
		await t.create();
		await t.sendTo("ada@x.io", M1);
		const act = async (action: string) => {
			const res = await t.s.request(CAMPAIGN_API.followUps(CID), {
				json: { action },
			});
			return {
				status: res.status,
				body: (await res.json()) as CampaignFollowUpActionResponse,
			};
		};

		let r = await act("pause");
		expect(r.body).toMatchObject({ changed: 1, followUp: { state: "paused" } });
		// Copies sent while paused start paused too.
		await t.sendTo("bob@y.org", M2);
		const states = () =>
			[...t.nudges.sequences.values()].map((x) => x.state).sort();
		expect(states()).toEqual(["paused", "paused"]);
		await t.run(T0 + 10 * DAY);
		expect(t.mailbox.sent).toHaveLength(0);

		r = await act("resume");
		expect(r.body.changed).toBe(2);
		expect(states()).toEqual(["active", "active"]);
		const list = (await (
			await t.s.request(`/api/nudges?groupId=${CID}`)
		).json()) as ListNudgesResponse;
		expect(list.sequences).toHaveLength(2);
		expect(list.sequences.every((x) => x.groupId === CID)).toBe(true);

		r = await act("cancel");
		expect(r.body.changed).toBe(2);
		expect(states()).toEqual(["cancelled", "cancelled"]);
		expect((await t.get()).followUpStats?.states).toEqual({ cancelled: 2 });
		expect((await act("resume")).status).toBe(409);
		const history = t.nudges.history.map((h) => h.kind);
		expect(history.filter((k) => k === "cancelled")).toHaveLength(2);
	});

	it("pages recipients in send order with filters", async () => {
		const t = followUpSetup();
		const recipients = Array.from({ length: 23 }, (_, i) => ({
			email: `r${String(i).padStart(2, "0")}@x.io`,
			...(i % 5 === 0 ? { name: `Person ${i}` } : {}),
			fields: {},
			...(i % 4 === 3 ? { skipReason: "Missing: x" } : {}),
		}));
		await t.create({ recipients, followUp: undefined, status: "draft" });

		const first = await t.get("?limit=10");
		expect(first.recipients.map((r) => r.email)).toEqual(
			recipients.slice(0, 10).map((r) => r.email),
		);
		expect(first.stats.total).toBe(23);
		const seen = first.recipients.map((r) => r.email);
		let cursor = first.recipientsNextCursor;
		while (cursor) {
			const page = (await (
				await t.s.request(
					`${CAMPAIGN_API.recipients(CID)}?limit=10&cursor=${cursor}`,
				)
			).json()) as ListRecipientsResponse;
			seen.push(...page.recipients.map((r) => r.email));
			cursor = page.nextCursor;
		}
		expect(seen).toEqual(recipients.map((r) => r.email));

		const skipped = await t.get("?state=skipped&limit=500");
		expect(skipped.recipients).toHaveLength(5);
		expect(skipped.recipientsNextCursor).toBeUndefined();
		const named = await t.get("?q=person");
		expect(named.recipients.map((r) => r.email)).toEqual([
			"r00@x.io",
			"r05@x.io",
			"r10@x.io",
			"r15@x.io",
			"r20@x.io",
		]);
		const both = await t.get("?state=queued,skipped&q=r1&limit=3");
		expect(both.recipients.map((r) => r.email)).toEqual([
			"r10@x.io",
			"r11@x.io",
			"r12@x.io",
		]);
		expect(
			(await t.s.request(`${CAMPAIGN_API.campaign(CID)}?state=bogus`)).status,
		).toBe(400);
		expect(
			(await t.s.request(`${CAMPAIGN_API.campaign(CID)}?cursor=zz`)).status,
		).toBe(400);
		// Page size is clamped to the maximum.
		const all = await t.get("?limit=99999");
		expect(all.recipients).toHaveLength(23);
	});
});
