import type {
	FeedResponse,
	ListNudgesResponse,
	MessageDetail,
	NudgeResponse,
	ThreadStatusResponse,
} from "@bet/shared";
import { describe, expect, it } from "vitest";
import { runScheduled } from "../../app";
import { FakeMailbox } from "../../connectors/fake";
import { apiModule } from "../../core/api";
import { retentionModule } from "../../core/retention";
import { trackingModule } from "../../core/tracking";
import { setup, T0 } from "../../test-utils";
import { createNudgesModule } from "./index";
import { LEASE_MS, MAX_ATTEMPTS } from "./schedule";
import { MemoryNudgeStore } from "./store/memory";

const DAY = 86_400_000;
const ID = "msg0000000000000000001";
const THREAD = "thread-1";
const FREQUENT = "*/15 * * * *";

function nudgeSetup() {
	const nudges = new MemoryNudgeStore();
	const time = { now: T0 };
	const mailbox = new FakeMailbox("me@example.com", () => time.now);
	const module = createNudgesModule({
		store: () => nudges,
		resolveConnector: async () => mailbox,
		fetch: async () => new Response("unexpected", { status: 500 }),
	});
	const modules = [trackingModule, apiModule, retentionModule, module];
	const s = setup({}, modules);
	const run = async (at: number, cron = FREQUENT) => {
		time.now = at;
		s.clock.now = at;
		await runScheduled(
			s.env,
			cron,
			{ store: () => s.store, now: () => at },
			modules,
		);
	};
	const connect = () =>
		nudges.saveConnector({
			kind: "google",
			email: "me@example.com",
			refreshTokenEnc: "sealed",
			scopes: "",
			connectedAt: T0,
		});
	/** Registers, marks sent, seeds the Gmail thread with the original. */
	const sendOriginal = async (
		recipients = [{ email: "ann@example.com", name: "Ann Lee" }],
	) => {
		await s.register({ recipients });
		await s.markSent(ID, T0, THREAD);
		mailbox.addMessage(THREAD, {
			from: "me@example.com",
			at: T0,
			messageIdHeader: "<orig@mail.example.com>",
		});
	};
	const create = async (body: Record<string, unknown> = {}) => {
		const res = await s.request("/api/nudges", {
			json: {
				messageId: ID,
				firstAfterDays: 3,
				intervalDays: 4,
				maxNudges: 2,
				template: "<p>Hi {{firstName|there}}, any thoughts?</p>",
				...body,
			},
		});
		return {
			res,
			body: (await res.json()) as NudgeResponse & { code?: string },
		};
	};
	const list = async () =>
		((await (await s.request("/api/nudges")).json()) as ListNudgesResponse)
			.sequences;
	return { s, nudges, mailbox, run, connect, sendOriginal, create, list };
}

describe("creating follow-ups", () => {
	it("needs a connector and a thread id", async () => {
		const t = nudgeSetup();
		await t.s.register();
		let r = await t.create();
		expect(r.res.status).toBe(409);
		expect(r.body.code).toBe("no_thread");
		await t.s.markSent(ID, T0, THREAD);
		r = await t.create();
		expect(r.res.status).toBe(409);
		expect(r.body.code).toBe("no_connector");
		await t.connect();
		r = await t.create();
		expect(r.res.status).toBe(201);
		expect(r.body.sequence).toMatchObject({
			state: "active",
			nextStep: 0,
			nextAt: T0 + 3 * DAY,
			providerThreadId: THREAD,
			subject: "Hello",
		});
		expect(r.body.sequence.steps.map((st) => st.afterDays)).toEqual([3, 4]);
		// Retrying returns the same sequence instead of creating another.
		const again = await t.create();
		expect(again.res.status).toBe(200);
		expect(again.body.sequence.id).toBe(r.body.sequence.id);
		expect(await t.list()).toHaveLength(1);
	});

	it("accepts a thread id in the request before markSent lands", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.s.register();
		const r = await t.create({ providerThreadId: "t-early", sentAt: T0 });
		expect(r.res.status).toBe(201);
		expect(r.body.sequence.providerThreadId).toBe("t-early");
	});

	it("validates input", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		for (const bad of [
			{ maxNudges: 0 },
			{ intervalDays: -1 },
			{ steps: [] },
			{ steps: [{ afterDays: 1, html: "" }] },
			{ sendWindow: { startHour: 18, endHour: 8 } },
			{ sendWindow: { startHour: 8, endHour: 18, timeZone: "Mars/Base" } },
		]) {
			expect((await t.create(bad)).res.status, JSON.stringify(bad)).toBe(400);
		}
	});
});

describe("scheduler", () => {
	it("sends nudges on schedule, threaded and tracked", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		await t.create();

		await t.run(T0 + 2 * DAY);
		expect(t.mailbox.sent).toHaveLength(0);

		await t.run(T0 + 3 * DAY);
		expect(t.mailbox.sent).toHaveLength(1);
		const first = t.mailbox.sent[0];
		expect(first?.thread).toEqual({ threadId: THREAD });
		expect(first?.reply).toMatchObject({
			from: "me@example.com",
			to: [{ email: "ann@example.com", name: "Ann Lee" }],
			subject: "Re: Hello",
			inReplyTo: "<orig@mail.example.com>",
			references: [],
		});
		const nudgeId = first?.reply.markerId as string;
		expect(first?.reply.html).toContain("Hi Ann, any thoughts?");
		expect(first?.reply.html).toContain(
			`https://t.example.com/o/${nudgeId}.gif`,
		);

		// The nudge is its own tracked message, linked to the original.
		const nudgeMsg = await t.s.store.getMessage(nudgeId);
		expect(nudgeMsg).toMatchObject({
			mode: "shared",
			groupId: ID,
			subject: "Re: Hello",
			sentAt: T0 + 3 * DAY,
			providerThreadId: THREAD,
		});

		let [seq] = await t.list();
		expect(seq).toMatchObject({ nextStep: 1, nextAt: T0 + 7 * DAY });
		expect(seq?.history.map((h) => h.kind)).toEqual(["created", "sent"]);

		await t.run(T0 + 7 * DAY);
		expect(t.mailbox.sent).toHaveLength(2);
		expect(t.mailbox.sent[1]?.reply).toMatchObject({
			inReplyTo: "<sent1@mail.example.com>",
			references: ["<orig@mail.example.com>"],
		});

		// After the last nudge: one more reply check, then done.
		[seq] = await t.list();
		expect(seq).toMatchObject({ state: "active", nextStep: 2 });
		await t.run(T0 + 11 * DAY);
		[seq] = await t.list();
		expect(seq?.state).toBe("done");
		expect(t.mailbox.sent).toHaveLength(2);

		// Feed shows nudges; counts are unaffected.
		const feed = (await (
			await t.s.request("/api/feed?since=0")
		).json()) as FeedResponse;
		expect(feed.events.map((e) => e.type)).toEqual([
			"nudge_sent",
			"nudge_sent",
		]);
		expect(feed.events[0]?.subject).toBe("Hello");
		const detail = (await (
			await t.s.request(`/api/messages/${ID}`)
		).json()) as MessageDetail;
		expect(detail).toMatchObject({ opens: 0, clicks: 0, machineOpens: 0 });
		const st = (await (
			await t.s.request(`/api/thread-status?ids=${THREAD}`)
		).json()) as ThreadStatusResponse;
		expect(st.threads[THREAD]?.status).toBe("unopened");
		expect(st.threads[THREAD]?.replied).toBeUndefined();
	});

	it("stops when someone replies, and reports it", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		await t.create();
		await t.run(T0 + 3 * DAY);
		// An out-of-office doesn't count; a real answer does.
		t.mailbox.addMessage(THREAD, {
			from: "ann@example.com",
			at: T0 + 3 * DAY + 1000,
			messageIdHeader: "<ooo@x>",
			auto: true,
		});
		await t.run(T0 + 7 * DAY);
		expect(t.mailbox.sent).toHaveLength(2);
		t.mailbox.addMessage(THREAD, {
			from: "ann@example.com",
			at: T0 + 8 * DAY,
			messageIdHeader: "<reply@x>",
		});
		await t.run(T0 + 11 * DAY);
		expect(t.mailbox.sent).toHaveLength(2);
		const [seq] = await t.list();
		expect(seq?.state).toBe("replied");
		expect(seq?.nextAt).toBeUndefined();

		const feed = (await (
			await t.s.request("/api/feed?since=0")
		).json()) as FeedResponse;
		expect(feed.events.at(-1)).toMatchObject({
			type: "reply",
			at: T0 + 8 * DAY,
		});
		const st = (await (
			await t.s.request(`/api/thread-status?ids=${THREAD}`)
		).json()) as ThreadStatusResponse;
		expect(st.threads[THREAD]).toMatchObject({
			status: "unopened",
			opens: 0,
			replied: true,
		});
	});

	it("stops on a reply that came before the first nudge", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		await t.create();
		t.mailbox.addMessage(THREAD, {
			from: "ann@example.com",
			at: T0 + DAY,
			messageIdHeader: "<r@x>",
		});
		await t.run(T0 + 3 * DAY);
		expect(t.mailbox.sent).toHaveLength(0);
		expect((await t.list())[0]?.state).toBe("replied");
	});

	it("never double-sends when a run crashes after sending", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		await t.create();
		t.mailbox.crashAfterSend = true;
		await t.run(T0 + 3 * DAY);
		expect(t.mailbox.sent).toHaveLength(1);
		let seq = t.nudges.sequences.values().next().value;
		expect(seq?.pendingSend?.nudgeMessageId).toBe(
			t.mailbox.sent[0]?.reply.markerId,
		);
		expect(seq?.attempts).toBe(1);
		expect(seq?.nextStep).toBe(0);

		// Retry after backoff: the marker is in the thread, so it completes without sending.
		await t.run(T0 + 3 * DAY + 16 * 60_000);
		expect(t.mailbox.sent).toHaveLength(1);
		seq = t.nudges.sequences.values().next().value;
		expect(seq).toMatchObject({ nextStep: 1, attempts: 0 });
		expect(seq?.pendingSend).toBeUndefined();
		const sent = t.nudges.history.filter((h) => h.kind === "sent");
		expect(sent).toHaveLength(1);
		const feed = (await (
			await t.s.request("/api/feed?since=0")
		).json()) as FeedResponse;
		expect(feed.events.filter((e) => e.type === "nudge_sent")).toHaveLength(1);
	});

	it("retries a failed send once, with the same nudge id", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		await t.create();
		t.mailbox.failSend = new Error("Gmail 500");
		await t.run(T0 + 3 * DAY);
		expect(t.mailbox.sent).toHaveLength(0);
		const pendingId = t.nudges.sequences.values().next().value
			?.pendingSend?.nudgeMessageId;
		expect(pendingId).toBeTruthy();
		// Still inside the backoff: nothing happens.
		await t.run(T0 + 3 * DAY + 5 * 60_000);
		expect(t.mailbox.findCalls).toBe(1);
		await t.run(T0 + 3 * DAY + 16 * 60_000);
		expect(t.mailbox.sent).toHaveLength(1);
		expect(t.mailbox.sent[0]?.reply.markerId).toBe(pendingId);
	});

	it("does not let overlapping runs claim the same sequence", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		await t.create();
		const at = T0 + 3 * DAY;
		const a = await t.nudges.claimDue(at, LEASE_MS, 10, "run-a");
		const b = await t.nudges.claimDue(at, LEASE_MS, 10, "run-b");
		expect(a).toHaveLength(1);
		expect(b).toHaveLength(0);
		// An expired lease can be taken over.
		const c = await t.nudges.claimDue(at + LEASE_MS + 1, LEASE_MS, 10, "run-c");
		expect(c).toHaveLength(1);
		// The old holder can no longer write.
		expect(
			await t.nudges.updateSequence(
				c[0]?.id as string,
				{ updatedAt: at },
				{ lockToken: "run-a" },
			),
		).toBe(false);
	});

	it("gives up after repeated errors", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		await t.create();
		let at = T0 + 3 * DAY;
		for (let i = 0; i < MAX_ATTEMPTS; i++) {
			t.mailbox.failFind = new Error("boom");
			await t.run(at);
			at += 13 * 3_600_000;
		}
		const [seq] = await t.list();
		expect(seq).toMatchObject({ state: "failed", lastError: "boom" });
		expect(t.mailbox.sent).toHaveLength(0);
	});

	it("marks bounces as failed", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		await t.create();
		t.mailbox.addMessage(THREAD, {
			from: "mailer-daemon@googlemail.com",
			at: T0 + 60_000,
			messageIdHeader: "<b@x>",
		});
		await t.run(T0 + 3 * DAY);
		expect((await t.list())[0]?.state).toBe("failed");
		expect(t.mailbox.sent).toHaveLength(0);
	});

	it("stops on open when asked", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		await t.create({ stopOnOpen: true });
		t.s.clock.now = T0 + DAY;
		await t.s.open(ID);
		await t.run(T0 + 3 * DAY);
		expect(t.mailbox.sent).toHaveLength(0);
		expect((await t.list())[0]?.state).toBe("opened");
	});

	it("waits for the send window", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal(); // T0 is Sunday 2026-11-01 12:00 UTC
		const r = await t.create({
			firstAfterDays: 6, // Saturday 7 Nov 12:00 UTC
			sendWindow: {
				startHour: 9,
				endHour: 17,
				weekdaysOnly: true,
				timeZone: "America/New_York",
			},
		});
		// Monday 9 Nov, 09:00 New York (EST, UTC-5) = 14:00 UTC
		expect(r.body.sequence.nextAt).toBe(Date.UTC(2026, 10, 9, 14));
	});

	it("handles individual-mode copies as separate sequences", async () => {
		const t = nudgeSetup();
		await t.connect();
		const group = "group00000000000000001";
		for (const [id, email, thread] of [
			["copyA00000000000000001", "ann@x.com", "t-a"],
			["copyB00000000000000001", "bob@x.com", "t-b"],
		] as const) {
			await t.s.register({
				id,
				mode: "individual",
				groupId: group,
				recipients: [{ email }],
			});
			await t.s.markSent(id, T0, thread);
			t.mailbox.addMessage(thread, {
				from: "me@example.com",
				at: T0,
				messageIdHeader: `<${id}@x>`,
			});
			await t.create({ messageId: id, template: "Hi {{name|there}}" });
		}
		t.mailbox.addMessage("t-a", {
			from: "ann@x.com",
			at: T0 + DAY,
			messageIdHeader: "<ra@x>",
		});
		await t.run(T0 + 3 * DAY);
		expect(t.mailbox.sent.map((x) => x.thread.threadId)).toEqual(["t-b"]);
		expect(t.mailbox.sent[0]?.reply.html).toContain("Hi there");
		const nudge = await t.s.store.getMessage(
			t.mailbox.sent[0]?.reply.markerId as string,
		);
		expect(nudge?.groupId).toBe(group);
		const states = Object.fromEntries(
			(await t.list()).map((x) => [x.messageId, x.state]),
		);
		expect(states).toEqual({
			copyA00000000000000001: "replied",
			copyB00000000000000001: "active",
		});
	});

	it("cancels when the original email was deleted", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		await t.create();
		await t.s.request(`/api/messages/${ID}`, { method: "DELETE" });
		await t.run(T0 + 3 * DAY);
		expect(t.nudges.sequences.values().next().value?.state).toBe("cancelled");
	});
});

describe("pause, resume, edit, cancel", () => {
	it("pauses and resumes", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		const { body } = await t.create();
		const id = body.sequence.id;
		const patch = (json: unknown) =>
			t.s.request(`/api/nudges/${id}`, { method: "PATCH", json });

		expect((await patch({ action: "pause" })).status).toBe(200);
		await t.run(T0 + 3 * DAY);
		expect(t.mailbox.sent).toHaveLength(0);
		expect((await patch({ action: "pause" })).status).toBe(409);

		const res = await patch({
			action: "resume",
			steps: [{ afterDays: 3, html: "<p>Edited</p>" }],
		});
		expect(res.status).toBe(200);
		const resumed = ((await res.json()) as NudgeResponse).sequence;
		expect(resumed.state).toBe("active");
		expect(resumed.history.map((h) => h.kind)).toEqual([
			"created",
			"paused",
			"resumed",
		]);
		await t.run(T0 + 3 * DAY + 60_000);
		expect(t.mailbox.sent).toHaveLength(1);
		expect(t.mailbox.sent[0]?.reply.html).toContain("Edited");
	});

	it("cancels", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		const { body } = await t.create();
		const id = body.sequence.id;
		const del = await t.s.request(`/api/nudges/${id}`, { method: "DELETE" });
		expect(((await del.json()) as NudgeResponse).sequence.state).toBe(
			"cancelled",
		);
		await t.run(T0 + 3 * DAY);
		expect(t.mailbox.sent).toHaveLength(0);
		expect(
			(
				await t.s.request(`/api/nudges/${id}`, {
					method: "PATCH",
					json: { action: "resume" },
				})
			).status,
		).toBe(409);
		// A new follow-up can be created for the same message afterwards.
		expect((await t.create()).res.status).toBe(201);
	});

	it("filters by state", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		await t.create();
		const res = await t.s.request("/api/nudges?state=paused");
		expect(((await res.json()) as ListNudgesResponse).sequences).toHaveLength(
			0,
		);
	});
});

describe("retention with the 15-minute cron", () => {
	it("purges only once a day", async () => {
		const s = setup({ RETENTION_DAYS: "10" });
		await s.register({ id: "old00000000000000000001" });
		const modules = [retentionModule];
		const run = (at: number, cron: string) =>
			runScheduled(
				s.env,
				cron,
				{ store: () => s.store, now: () => at },
				modules,
			);
		const day12 = T0 + 12 * DAY; // 12:00 UTC
		await run(day12, FREQUENT);
		expect(s.store.messages.size).toBe(1);
		await run(Date.UTC(2026, 10, 14, 3, 0, 5), FREQUENT);
		expect(s.store.messages.size).toBe(0);
		await s.register({ id: "old00000000000000000002" });
		await run(T0 + 30 * DAY, "17 3 * * *");
		expect(s.store.messages.size).toBe(0);
	});

	it("purges old finished sequences in the daily slot", async () => {
		const t = nudgeSetup();
		await t.connect();
		await t.sendOriginal();
		const { body } = await t.create();
		await t.s.request(`/api/nudges/${body.sequence.id}`, { method: "DELETE" });
		await t.run(T0 + 200 * DAY + 3 * 3_600_000); // not 03:00 UTC
		expect(t.nudges.sequences.size).toBe(1);
		await t.run(Date.UTC(2027, 5, 1, 3, 1));
		expect(t.nudges.sequences.size).toBe(0);
	});
});
