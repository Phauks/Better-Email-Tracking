import type {
	FeedResponse,
	ListMessagesResponse,
	MessageDetail,
	ThreadStatusResponse,
} from "@bet/shared";
import { describe, expect, it } from "vitest";
import { isDailyRun, runScheduled } from "../app";
import { TRANSPARENT_GIF } from "../lib/gif";
import { CHROME_UA, GOOGLE_PROXY_UA, setup, T0, TOKEN } from "../test-utils";
import type { DailyContext, TrackerModule } from "../types";

const ID = "msg0000000000000000001";
const SEC = 1000;

async function detail(s: ReturnType<typeof setup>, id = ID) {
	return (await (
		await s.request(`/api/messages/${id}`)
	).json()) as MessageDetail;
}

describe("pixel", () => {
	it("returns a 43-byte no-store gif for valid, unknown and junk ids", async () => {
		const s = setup();
		for (const path of [
			`/o/${ID}.gif`,
			"/o/unknownunknownunknown.gif",
			"/o/..%2f.gif",
			"/o/x",
		]) {
			const res = await s.request(path);
			expect(res.status).toBe(200);
			expect(res.headers.get("Content-Type")).toBe("image/gif");
			expect(res.headers.get("Cache-Control")).toContain("no-store");
			expect(res.headers.get("Pragma")).toBe("no-cache");
			expect(res.headers.get("Expires")).toBe("0");
			const bytes = new Uint8Array(await res.arrayBuffer());
			expect(bytes.byteLength).toBe(43);
			expect(bytes).toEqual(TRANSPARENT_GIF);
		}
		expect(s.store.events).toHaveLength(0);
	});

	it("still returns the gif when the store throws", async () => {
		const s = setup();
		s.store.getMessage = async () => {
			throw new Error("db down");
		};
		const res = await s.open(ID);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/gif");
	});

	it("records an open with hashed ip and device, no location by default", async () => {
		const s = setup();
		await s.register();
		s.clock.now = T0 + 60 * SEC;
		await s.open(ID, { cf: { city: "Paris", country: "FR" } });
		const [ev] = s.store.events;
		expect(ev).toMatchObject({
			type: "open",
			source: "direct",
			device: "Browser on macOS",
		});
		expect(ev?.ipHash).toMatch(/^[0-9a-f]{32}$/);
		expect(JSON.stringify(ev)).not.toContain("203.0.113.9");
		expect(ev?.location).toBeUndefined();
	});

	it("stores location only when STORE_LOCATION=true", async () => {
		const s = setup({ STORE_LOCATION: "true" });
		await s.register();
		s.clock.now = T0 + 60 * SEC;
		await s.open(ID, { cf: { city: "Paris", country: "FR" } });
		expect(s.store.events[0]?.location).toBe("Paris, FR");
	});

	it("does not record when opens are not tracked", async () => {
		const s = setup();
		await s.register({ trackOpens: false });
		s.clock.now = T0 + 60 * SEC;
		await s.open(ID);
		expect(s.store.events).toHaveLength(0);
	});
});

describe("click", () => {
	it("redirects only to the registered url", async () => {
		const s = setup();
		await s.register();
		s.clock.now = T0 + 60 * SEC;
		const res = await s.request(`/c/${ID}/1`, { ua: CHROME_UA });
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("https://example.com/b");
		expect(s.store.events[0]).toMatchObject({ type: "click", linkIndex: 1 });
	});

	it("has no open redirect", async () => {
		const s = setup();
		await s.register();
		const cases = [
			`/c/${ID}/7`,
			`/c/${ID}/-1`,
			`/c/${ID}/https:%2F%2Fevil.com`,
			"/c/nonexistent000000000001/0",
			`/c/${ID}/0?url=https://evil.com`.replace("/0?", "/9?"),
			"/c/..%2F..%2Fevil/0",
		];
		for (const path of cases) {
			const res = await s.request(path);
			expect(res.status, path).toBe(404);
			expect(res.headers.get("Location")).toBeNull();
			expect(res.headers.get("Content-Type")).toContain("text/html");
		}
		// Query params never influence the target.
		const ok = await s.request(`/c/${ID}/0?url=https://evil.com`);
		expect(ok.headers.get("Location")).toBe("https://example.com/a");
	});

	it("rejects non-http links at registration", async () => {
		const s = setup();
		const res = await s.request("/api/messages", {
			json: {
				id: ID,
				provider: "gmail",
				subject: "x",
				recipients: [],
				links: ["javascript:alert(1)"],
				mode: "shared",
				trackOpens: true,
				trackLinks: true,
			},
		});
		expect(res.status).toBe(400);
	});
});

describe("own-open suppression", () => {
	it("ignores opens within the send grace window (createdAt, then sentAt)", async () => {
		const s = setup();
		await s.register();
		s.clock.now = T0 + 10 * SEC;
		await s.open(ID);
		expect(s.store.events[0]?.ignored).toBe("send_grace");

		await s.markSent(ID, T0 + 30 * SEC);
		s.clock.now = T0 + 45 * SEC; // 15s after send
		await s.open(ID);
		expect(s.store.events[1]?.ignored).toBe("send_grace");

		s.clock.now = T0 + 55 * SEC; // 25s after send
		await s.open(ID);
		expect(s.store.events[2]?.ignored).toBeUndefined();
	});

	it("ignores opens within the owner window after an owner view", async () => {
		const s = setup();
		await s.register();
		s.clock.now = T0 + 120 * SEC;
		const view = await s.request("/api/owner-views", {
			json: { messageIds: [ID] },
			ip: "198.51.100.1",
		});
		expect(view.status).toBe(200);
		s.clock.now = T0 + 150 * SEC;
		await s.open(ID, { ua: GOOGLE_PROXY_UA, ip: "66.249.1.1" });
		expect(s.store.events[0]?.ignored).toBe("owner");
		s.clock.now = T0 + 170 * SEC; // 50s after view
		await s.open(ID, { ua: GOOGLE_PROXY_UA, ip: "66.249.1.1" });
		expect(s.store.events[1]?.ignored).toBeUndefined();
	});

	it("retroactively ignores opens just before an owner view", async () => {
		const s = setup();
		await s.register();
		s.clock.now = T0 + 100 * SEC;
		await s.open(ID, { ua: GOOGLE_PROXY_UA, ip: "66.249.1.1" });
		s.clock.now = T0 + 200 * SEC;
		await s.open(ID, { ua: GOOGLE_PROXY_UA, ip: "66.249.1.1" });
		s.clock.now = T0 + 202 * SEC;
		await s.request("/api/owner-views", { json: { messageIds: [ID] } });
		expect(s.store.events.map((e) => e.ignored)).toEqual([undefined, "owner"]);
	});

	it("ignores direct opens from an owner ip seen in the last 30 days", async () => {
		const s = setup();
		await s.register();
		await s.register({ id: "other000000000000000001" });
		s.clock.now = T0 + 60 * SEC;
		await s.request("/api/owner-views", {
			json: { messageIds: ["other000000000000000001"] },
			ip: "198.51.100.7",
		});
		s.clock.now = T0 + 2 * 86_400 * SEC;
		await s.open(ID, { ip: "198.51.100.7" });
		await s.open(ID, { ip: "198.51.100.7", ua: GOOGLE_PROXY_UA });
		await s.open(ID, { ip: "203.0.113.50" });
		expect(s.store.events.map((e) => e.ignored)).toEqual([
			"owner",
			undefined,
			undefined,
		]);

		s.clock.now = T0 + 31 * 86_400 * SEC;
		await s.open(ID, { ip: "198.51.100.7" });
		expect(s.store.events[3]?.ignored).toBeUndefined();
	});

	it("keeps ignored events in detail but out of counts and feed", async () => {
		const s = setup();
		await s.register();
		s.clock.now = T0 + 5 * SEC;
		await s.open(ID);
		s.clock.now = T0 + 60 * SEC;
		await s.open(ID);
		const d = await detail(s);
		expect(d.events).toHaveLength(2);
		expect(d.events[0]?.ignored).toBe("send_grace");
		expect(d.opens).toBe(1);
		expect(JSON.stringify(d)).not.toContain("ipHash");
		const feed = (await (
			await s.request("/api/feed?since=0")
		).json()) as FeedResponse;
		expect(feed.events).toHaveLength(1);
	});
});

describe("counts and status", () => {
	it("splits human opens, machine opens and scanner clicks", async () => {
		const s = setup();
		await s.register();
		await s.markSent(ID, T0, "thread-1");
		s.clock.now = T0 + 60 * SEC;
		await s.open(ID, {
			ua: "Mozilla/5.0",
			cf: { asn: 714, asOrganization: "Apple Inc." },
		});
		let st = (await (
			await s.request("/api/thread-status?ids=thread-1,nope")
		).json()) as ThreadStatusResponse;
		expect(st.threads["thread-1"]?.status).toBe("machine_only");
		expect(st.threads.nope).toBeUndefined();

		await s.request(`/c/${ID}/0`, { ua: "Mimecast scanner" });
		st = (await (
			await s.request("/api/thread-status?ids=thread-1")
		).json()) as ThreadStatusResponse;
		expect(st.threads["thread-1"]?.status).toBe("machine_only");

		await s.open(ID, { ua: GOOGLE_PROXY_UA });
		await s.request(`/c/${ID}/0`, { ua: CHROME_UA });
		const d = await detail(s);
		expect(d).toMatchObject({
			opens: 1,
			machineOpens: 1,
			clicks: 1,
			firstOpenAt: T0 + 60 * SEC,
		});
		st = (await (
			await s.request("/api/thread-status", {
				json: { threadIds: ["thread-1"] },
			})
		).json()) as ThreadStatusResponse;
		expect(st.threads["thread-1"]).toMatchObject({
			status: "clicked",
			opens: 1,
			clicks: 1,
		});
	});

	it("aggregates a thread across messages and lists individual recipients", async () => {
		const s = setup();
		const group = "group00000000000000001";
		const a = "copyA00000000000000001";
		const b = "copyB00000000000000001";
		await s.register({
			id: a,
			mode: "individual",
			groupId: group,
			recipients: [{ email: "Ann@x.com" }],
		});
		await s.register({
			id: b,
			mode: "individual",
			groupId: group,
			recipients: [{ email: "bob@x.com" }],
		});
		await s.markSent(a, T0, "t-a");
		await s.markSent(b, T0, "t-b");
		s.clock.now = T0 + 60 * SEC;
		await s.open(b, { ua: GOOGLE_PROXY_UA });

		const st = (await (
			await s.request("/api/thread-status?ids=t-a,t-b")
		).json()) as ThreadStatusResponse;
		expect(st.threads["t-a"]?.status).toBe("unopened");
		expect(st.threads["t-b"]?.status).toBe("opened");
		expect(st.threads["t-a"]?.recipients).toEqual([
			{ email: "Ann@x.com", status: "unopened" },
			{ email: "bob@x.com", status: "opened" },
		]);

		// A shared message in the same thread: strongest status wins.
		await s.register({ id: "shared0000000000000001" });
		await s.markSent("shared0000000000000001", T0, "t-a");
		await s.request("/c/shared0000000000000001/0", { ua: CHROME_UA });
		const st2 = (await (
			await s.request("/api/thread-status?ids=t-a")
		).json()) as ThreadStatusResponse;
		expect(st2.threads["t-a"]?.status).toBe("clicked");

		const list = (await (
			await s.request(`/api/messages?groupId=${group}`)
		).json()) as ListMessagesResponse;
		expect(list.messages.map((m) => m.id).sort()).toEqual([a, b]);
	});
});

describe("api", () => {
	it("rejects missing or wrong tokens, allows health", async () => {
		const s = setup();
		expect((await s.request("/api/messages", { auth: false })).status).toBe(
			401,
		);
		expect(
			(
				await s.request("/api/messages", {
					auth: false,
					headers: { Authorization: "Bearer nope" },
				})
			).status,
		).toBe(401);
		expect(
			(
				await s.request("/api/feed", {
					auth: false,
					headers: { Authorization: TOKEN },
				})
			).status,
		).toBe(401);
		const health = await s.request("/api/health", { auth: false });
		expect(await health.json()).toEqual({ ok: true });
		const noToken = setup({ API_TOKEN: "" });
		expect((await noToken.request("/api/messages")).status).toBe(401);
	});

	it("upserts idempotently, keeping createdAt and replacing links", async () => {
		const s = setup();
		await s.register();
		s.clock.now = T0 + 5 * SEC;
		await s.register({ subject: "Edited", links: ["https://example.com/new"] });
		const d = await detail(s);
		expect(d).toMatchObject({
			subject: "Edited",
			createdAt: T0,
			links: ["https://example.com/new"],
		});
		expect(s.store.messages.size).toBe(1);
	});

	it("validates ids and 404s unknown messages", async () => {
		const s = setup();
		expect(
			(await s.request("/api/messages", { json: { id: "bad" } })).status,
		).toBe(400);
		expect(
			(await s.request("/api/messages/nonexistent000000000001")).status,
		).toBe(404);
		expect(
			(
				await s.request("/api/messages/nonexistent000000000001/sent", {
					json: { sentAt: T0 },
				})
			).status,
		).toBe(404);
	});

	it("lists newest first with before/limit/q, and deletes", async () => {
		const s = setup();
		for (let i = 0; i < 3; i++) {
			s.clock.now = T0 + i * SEC;
			await s.register({
				id: `list00000000000000000${i}`,
				subject: `Subject ${i}`,
			});
		}
		let list = (await (
			await s.request("/api/messages?limit=2")
		).json()) as ListMessagesResponse;
		expect(list.messages.map((m) => m.subject)).toEqual([
			"Subject 2",
			"Subject 1",
		]);
		list = (await (
			await s.request(`/api/messages?before=${T0 + SEC}`)
		).json()) as ListMessagesResponse;
		expect(list.messages.map((m) => m.subject)).toEqual(["Subject 0"]);
		list = (await (
			await s.request("/api/messages?q=subject%201")
		).json()) as ListMessagesResponse;
		expect(list.messages).toHaveLength(1);

		const del = await s.request("/api/messages/list000000000000000000", {
			method: "DELETE",
		});
		expect(del.status).toBe(200);
		expect(
			(await s.request("/api/messages/list000000000000000000")).status,
		).toBe(404);
	});

	it("pages the feed with a cursor", async () => {
		const s = setup();
		await s.register();
		s.clock.now = T0 + 60 * SEC;
		for (let i = 0; i < 3; i++) await s.open(ID);
		await s.request(`/c/${ID}/1`, { ua: CHROME_UA });

		let feed = (await (
			await s.request("/api/feed?since=0&limit=2")
		).json()) as FeedResponse;
		expect(feed.events.map((e) => e.id)).toEqual([1, 2]);
		expect(feed.cursor).toBe(2);
		expect(feed.events[0]).toMatchObject({
			subject: "Hello",
			recipients: [{ email: "a@example.com" }],
		});
		feed = (await (
			await s.request(`/api/feed?since=${feed.cursor}`)
		).json()) as FeedResponse;
		expect(feed.events.map((e) => e.id)).toEqual([3, 4]);
		expect(feed.events[1]?.linkUrl).toBe("https://example.com/b");
		feed = (await (
			await s.request(`/api/feed?since=${feed.cursor}`)
		).json()) as FeedResponse;
		expect(feed).toEqual({ events: [], cursor: 4 });

		// No `since`: most recent events, cursor ready for polling.
		feed = (await (
			await s.request("/api/feed?limit=1")
		).json()) as FeedResponse;
		expect(feed.events.map((e) => e.id)).toEqual([4]);
		expect(feed.cursor).toBe(4);
	});

	it("handles CORS preflight for extension origins only", async () => {
		const s = setup({ ALLOWED_ORIGINS: "https://dash.example.com" });
		const preflight = (origin: string) =>
			s.request("/api/messages", {
				method: "OPTIONS",
				auth: false,
				headers: {
					Origin: origin,
					"Access-Control-Request-Method": "POST",
					"Access-Control-Request-Headers": "authorization,content-type",
				},
			});
		for (const origin of [
			"chrome-extension://abcdef",
			"moz-extension://1234-5678",
			"https://dash.example.com",
		]) {
			const res = await preflight(origin);
			expect(res.status).toBe(204);
			expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
			expect(
				res.headers.get("Access-Control-Allow-Headers")?.toLowerCase(),
			).toContain("authorization");
		}
		const evil = await preflight("https://evil.com");
		expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});
});

describe("retention", () => {
	it("purges data older than RETENTION_DAYS", async () => {
		const s = setup({ RETENTION_DAYS: "10" });
		await s.register({ id: "old00000000000000000001" });
		s.clock.now = T0 + 60 * SEC;
		await s.open("old00000000000000000001");
		s.clock.now = T0 + 9 * 86_400 * SEC;
		await s.register({ id: "new00000000000000000001" });
		await runScheduled(s.env, "17 3 * * *", {
			store: () => s.store,
			now: () => T0 + 11 * 86_400 * SEC,
		});
		expect([...s.store.messages.keys()]).toEqual(["new00000000000000000001"]);
		expect(s.store.events).toHaveLength(0);
	});
});

describe("scheduler", () => {
	const FREQUENT = "*/15 * * * *";

	function recorder() {
		const calls: string[] = [];
		let daily: DailyContext | undefined;
		const mod = (name: string, fail = false): TrackerModule => ({
			name,
			async daily(ctx) {
				daily = ctx;
				calls.push(`daily ${name}`);
				if (fail) throw new Error("boom");
			},
			async scheduled() {
				calls.push(`scheduled ${name}`);
			},
		});
		return { calls, mod, daily: () => daily };
	}

	it("gates daily hooks to one run a day", () => {
		expect(isDailyRun(FREQUENT, Date.UTC(2026, 10, 2, 3, 0))).toBe(true);
		expect(isDailyRun(FREQUENT, Date.UTC(2026, 10, 2, 3, 15))).toBe(false);
		expect(isDailyRun(FREQUENT, Date.UTC(2026, 10, 2, 12, 0))).toBe(false);
		expect(isDailyRun("17 3 * * *", Date.UTC(2026, 10, 2, 12, 0))).toBe(true);
	});

	it("runs daily hooks first, then every scheduled hook, despite failures", async () => {
		const s = setup({ RETENTION_DAYS: "10" });
		const r = recorder();
		const at = Date.UTC(2026, 10, 2, 3, 5);
		await runScheduled(
			s.env,
			FREQUENT,
			{ store: () => s.store, now: () => at },
			[r.mod("a", true), r.mod("b")],
		);
		expect(r.calls).toEqual([
			"daily a",
			"daily b",
			"scheduled a",
			"scheduled b",
		]);
		expect(r.daily()?.purgeBefore).toBe(at - 10 * 86_400 * SEC);
	});

	it("skips daily hooks outside the daily slot and omits purgeBefore when retention is off", async () => {
		const s = setup({ RETENTION_DAYS: "0" });
		const r = recorder();
		const noon = Date.UTC(2026, 10, 2, 12, 0);
		await runScheduled(
			s.env,
			FREQUENT,
			{ store: () => s.store, now: () => noon },
			[r.mod("a")],
		);
		expect(r.calls).toEqual(["scheduled a"]);
		await runScheduled(
			s.env,
			"17 3 * * *",
			{ store: () => s.store, now: () => noon },
			[r.mod("a")],
		);
		expect(r.daily()?.purgeBefore).toBeUndefined();
	});
});
