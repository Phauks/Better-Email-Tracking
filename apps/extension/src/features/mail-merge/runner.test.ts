import {
	type CampaignDetail,
	type CampaignRecipient,
	type CampaignSummary,
	DEFAULT_CAMPAIGN_SETTINGS,
	type RecipientResultRequest,
} from "@bet/shared";
import { describe, expect, it } from "vitest";
import {
	campaignsToRun,
	capReason,
	INTERRUPTED_ERROR,
	leaseTtlMs,
	nextDelayMs,
	nextSendAt,
	nextStep,
} from "./queue";
import { type RunnerDeps, runCampaign, UNCONFIRMED_ERROR } from "./runner";

const T0 = 1_000_000;
const SEC = 1000;

function recipient(
	email: string,
	state: CampaignRecipient["state"] = "queued",
	fields: Record<string, string> = { first_name: email[0] ?? "" },
): CampaignRecipient {
	return { email, state, fields };
}

function campaign(
	recipients: CampaignRecipient[],
	overrides: Partial<CampaignDetail> = {},
): CampaignDetail {
	return {
		id: "camp",
		name: "Test",
		provider: "gmail",
		subjectTemplate: "Hi {{first_name}}",
		bodyTemplate: "Hello {{first_name}}",
		status: "sending",
		settings: {
			...DEFAULT_CAMPAIGN_SETTINGS,
			minDelaySec: 20,
			maxDelaySec: 40,
		},
		createdAt: T0,
		updatedAt: T0,
		stats: {
			total: 0,
			queued: 0,
			sending: 0,
			sent: 0,
			failed: 0,
			skipped: 0,
			opened: 0,
			clicked: 0,
			machineOnly: 0,
			unopened: 0,
		},
		recipients,
		...overrides,
	} as CampaignDetail;
}

describe("queue", () => {
	it("jitters delays within the configured range", () => {
		const s = { minDelaySec: 20, maxDelaySec: 40 };
		expect(nextDelayMs(s, () => 0)).toBe(20_000);
		expect(nextDelayMs(s, () => 0.5)).toBe(30_000);
		expect(nextDelayMs(s, () => 0.999_999)).toBe(40_000);
		expect(nextDelayMs({ minDelaySec: 30, maxDelaySec: 10 }, () => 1)).toBe(
			30_000,
		);
	});

	it("schedules from the last send, never in the past", () => {
		expect(nextSendAt(undefined, 30_000, T0)).toBe(T0);
		expect(nextSendAt(T0, 30_000, T0 + 5_000)).toBe(T0 + 30_000);
		expect(nextSendAt(T0, 30_000, T0 + 90_000)).toBe(T0 + 90_000);
		expect(leaseTtlMs({ maxDelaySec: 40 })).toBe(220_000);
	});

	it("picks the next step: stop, interrupted, cap, send, done", () => {
		const r = [recipient("a@x.io", "sent"), recipient("b@x.io")];
		expect(nextStep(campaign(r, { status: "paused" }), 0).kind).toBe("stop");
		expect(nextStep(campaign(r), 0)).toEqual({
			kind: "send",
			recipient: r[1],
		});
		expect(nextStep(campaign(r), 50)).toEqual({
			kind: "cap",
			reason: capReason(50),
		});
		expect(nextStep(campaign([recipient("a@x.io", "sending")]), 0).kind).toBe(
			"interrupted",
		);
		expect(nextStep(campaign([recipient("a@x.io", "failed")]), 0).kind).toBe(
			"done",
		);
	});

	it("runs only sending campaigns of this provider, oldest first", () => {
		const base = campaign([]) as CampaignSummary;
		const list = [
			{ ...base, id: "new", createdAt: 3 },
			{ ...base, id: "old", createdAt: 1 },
			{ ...base, id: "paused", status: "paused" as const },
			{ ...base, id: "outlook", provider: "outlook" },
		];
		expect(campaignsToRun(list, "gmail").map((c) => c.id)).toEqual([
			"old",
			"new",
		]);
	});
});

/** A fake Worker with the same state rules as the real one, plus a fake clock. */
function harness(c: CampaignDetail) {
	const clock = { now: T0 };
	const log: string[] = [];
	let ids = 0;
	let leaseHolder: string | undefined;
	const sends: { to: string; subject: string; html: string }[] = [];
	const gets: string[] = [];
	const results: RecipientResultRequest[] = [];
	let sendImpl: (to: string) => Promise<{ confirmed: boolean }> = async () => ({
		confirmed: true,
	});

	const find = (email: string) => {
		const r = c.recipients.find((x) => x.email === email);
		if (!r) throw new Error("no recipient");
		return r;
	};
	const finish = () => {
		if (
			!c.recipients.some((r) => r.state === "queued" || r.state === "sending")
		)
			if (c.status === "sending") c.status = "done";
	};

	const deps: RunnerDeps = {
		runnerId: "runner-1",
		makeId: () => `m${++ids}`,
		now: () => clock.now,
		sleep: async (ms) => {
			log.push(`sleep ${ms / SEC}s`);
			clock.now += ms;
		},
		random: () => 0.5, // 30 s with the 20-40 s default
		pollMs: 15_000,
		send: async ({ recipient, rendered }) => {
			sends.push({
				to: recipient.email,
				subject: rendered.subject,
				html: rendered.html,
			});
			log.push(`send ${recipient.email}`);
			clock.now += 2 * SEC;
			return sendImpl(recipient.email);
		},
		api: {
			// Like the Worker: stats from the whole queue, recipients filtered and paged.
			get: async (_id, query) => {
				const out = structuredClone(c);
				const count = (state: string) =>
					c.recipients.filter((r) => r.state === state).length;
				out.stats = {
					...out.stats,
					queued: count("queued"),
					sending: count("sending"),
				};
				const states = query?.state;
				out.recipients = out.recipients
					.filter((r) => !states || states.includes(r.state))
					.slice(0, query?.limit ?? 100);
				gets.push(states?.join(",") ?? "all");
				return out;
			},
			lease: async (_id, req) => {
				if (leaseHolder && leaseHolder !== req.runnerId) return false;
				leaseHolder = req.runnerId;
				return c.status === "sending";
			},
			result: async (_id, email, req) => {
				const r = find(email);
				const from =
					req.state === "sending" ? ["queued"] : ["queued", "sending"];
				if (
					!from.includes(r.state) ||
					(req.state === "sending" && c.status !== "sending")
				)
					return { ok: false, conflict: true, error: "409" };
				results.push(req);
				r.state = req.state;
				if (req.messageId) r.messageId = req.messageId;
				if (req.error) r.error = req.error;
				if (req.state === "sent") {
					r.sentAt = req.sentAt ?? clock.now;
					c.lastSentAt = r.sentAt;
				}
				if (req.state !== "sending") finish();
				log.push(`${req.state} ${email}`);
				return { ok: true, campaignStatus: c.status };
			},
			update: async (_id, req) => {
				if (req.action === "pause") {
					c.status = "paused";
					if (req.reason) c.pauseReason = req.reason;
				}
				log.push(`${req.action}`);
				return structuredClone(c);
			},
		},
	};
	return {
		c,
		clock,
		log,
		sends,
		gets,
		results,
		deps,
		setSend: (f: typeof sendImpl) => {
			sendImpl = f;
		},
		holdLease: (id: string) => {
			leaseHolder = id;
		},
	};
}

describe("runCampaign", () => {
	it("sends one at a time with throttling and finishes", async () => {
		const h = harness(
			campaign([recipient("a@x.io"), recipient("b@x.io"), recipient("c@x.io")]),
		);
		const res = await runCampaign("camp", h.deps);
		expect(res).toEqual({ outcome: "done", sent: 3 });
		expect(h.c.status).toBe("done");
		// 30 s planned spacing, polled in 15 s slices, measured from the last sentAt.
		expect(h.log).toEqual([
			"sending a@x.io",
			"send a@x.io",
			"sent a@x.io",
			"sleep 15s",
			"sleep 15s",
			"sending b@x.io",
			"send b@x.io",
			"sent b@x.io",
			"sleep 15s",
			"sleep 15s",
			"sending c@x.io",
			"send c@x.io",
			"sent c@x.io",
		]);
		expect(h.sends[1]).toEqual({
			to: "b@x.io",
			subject: "Hi b",
			html: "Hello b",
		});
		expect(h.c.recipients.map((r) => r.messageId)).toEqual(["m1", "m2", "m3"]);
	});

	it("pauses at the per-run cap with a reason", async () => {
		const h = harness(
			campaign(
				[recipient("a@x.io"), recipient("b@x.io"), recipient("c@x.io")],
				{
					settings: { ...DEFAULT_CAMPAIGN_SETTINGS, perRunCap: 2 },
				},
			),
		);
		expect(await runCampaign("camp", h.deps)).toEqual({
			outcome: "cap",
			sent: 2,
		});
		expect(h.c.status).toBe("paused");
		expect(h.c.pauseReason).toBe(capReason(2));
		expect(h.c.recipients[2]?.state).toBe("queued");
	});

	it("resumes after a reload: waits from the last send and fails interrupted claims", async () => {
		const h = harness(
			campaign(
				[
					{ ...recipient("a@x.io", "sent"), sentAt: T0 - 10 * SEC },
					recipient("b@x.io", "sending"),
					recipient("c@x.io"),
				],
				{ lastSentAt: T0 - 10 * SEC },
			),
		);
		const res = await runCampaign("camp", h.deps);
		expect(res).toEqual({ outcome: "done", sent: 1 });
		expect(h.c.recipients[1]).toMatchObject({
			state: "failed",
			error: INTERRUPTED_ERROR,
		});
		// 30 s spacing, 10 s already elapsed: wait 15 s + 5 s.
		expect(h.log.slice(1, 4)).toEqual([
			"sleep 15s",
			"sleep 5s",
			"sending c@x.io",
		]);
	});

	it("stops when paused from the dashboard during a wait", async () => {
		const h = harness(campaign([recipient("a@x.io"), recipient("b@x.io")]));
		const sleep = h.deps.sleep;
		h.deps.sleep = async (ms) => {
			await sleep(ms);
			h.c.status = "paused";
		};
		expect(await runCampaign("camp", h.deps)).toEqual({
			outcome: "stopped",
			sent: 1,
		});
		expect(h.c.recipients[1]?.state).toBe("queued");
	});

	it("does nothing when another tab holds the lease", async () => {
		const h = harness(campaign([recipient("a@x.io")]));
		h.holdLease("other-tab");
		expect(await runCampaign("camp", h.deps)).toEqual({
			outcome: "busy",
			sent: 0,
		});
		expect(h.sends).toEqual([]);
	});

	it("skips recipients with missing fields under the block policy", async () => {
		const h = harness(
			campaign([recipient("a@x.io", "queued", {}), recipient("b@x.io")]),
		);
		await runCampaign("camp", h.deps);
		expect(h.c.recipients[0]).toMatchObject({
			state: "skipped",
			error: "Missing: first_name",
		});
		expect(h.sends.map((s) => s.to)).toEqual(["b@x.io"]);
	});

	it("records failures and pauses after three in a row", async () => {
		const h = harness(
			campaign([
				recipient("a@x.io"),
				recipient("b@x.io"),
				recipient("c@x.io"),
				recipient("d@x.io"),
			]),
		);
		h.setSend(async (to) => {
			if (to === "a@x.io") return { confirmed: false };
			throw new Error("compose failed");
		});
		const res = await runCampaign("camp", h.deps);
		expect(res).toEqual({ outcome: "failing", sent: 0 });
		expect(h.c.recipients.map((r) => [r.state, r.error])).toEqual([
			["failed", UNCONFIRMED_ERROR],
			["failed", "compose failed"],
			["failed", "compose failed"],
			["queued", undefined],
		]);
		expect(h.c.status).toBe("paused");
		expect(h.c.pauseReason).toMatch(/3 sends failed in a row/);
	});

	it("asks only for the recipients it needs and reports the thread id", async () => {
		const h = harness(
			campaign([recipient("a@x.io", "sending"), recipient("b@x.io")]),
		);
		h.setSend(async () => ({ confirmed: true, providerThreadId: "thr-b" }));
		const res = await runCampaign("camp", h.deps);
		expect(res).toEqual({ outcome: "done", sent: 1 });
		// The stale claim is only fetched while one exists.
		expect(h.gets.slice(0, 2)).toEqual(["queued", "sending"]);
		expect(h.gets.filter((g) => g === "all")).toEqual([]);
		expect(h.results.at(-1)).toMatchObject({
			state: "sent",
			providerThreadId: "thr-b",
		});
		expect(h.c.recipients[0]?.state).toBe("failed");
	});
});
