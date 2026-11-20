import type { RegisterMessageRequest } from "@bet/shared";
import { createApp } from "./app";
import type { Env } from "./env";
import { MemoryStore } from "./store/memory";
import type { TrackerModule } from "./types";

export const TOKEN = "test-token";
export const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);

export interface Cf {
	asn?: number;
	asOrganization?: string;
	city?: string;
	country?: string;
}

export interface ReqOptions extends Omit<RequestInit, "cf"> {
	cf?: Cf;
	ip?: string;
	ua?: string;
	auth?: boolean;
	json?: unknown;
}

export const CHROME_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
export const GOOGLE_PROXY_UA =
	"Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)";

export function setup(
	envOverrides: Partial<Env> = {},
	modules?: TrackerModule[],
) {
	const store = new MemoryStore();
	const clock = { now: T0 };
	const app = createApp({ store: () => store, now: () => clock.now }, modules);
	const env: Env = {
		DB: {} as D1Database,
		API_TOKEN: TOKEN,
		IP_SALT: "salt",
		SEND_GRACE_SECONDS: "20",
		OWNER_WINDOW_SECONDS: "45",
		RETENTION_DAYS: "180",
		STORE_LOCATION: "false",
		...envOverrides,
	};

	async function request(
		path: string,
		opts: ReqOptions = {},
	): Promise<Response> {
		const { cf, ip, ua, auth, json, ...init } = opts;
		const headers = new Headers(init.headers);
		if (ua !== undefined) headers.set("User-Agent", ua);
		if (ip) headers.set("CF-Connecting-IP", ip);
		if (auth !== false && path.startsWith("/api"))
			headers.set("Authorization", `Bearer ${TOKEN}`);
		if (json !== undefined) {
			headers.set("Content-Type", "application/json");
			init.body = JSON.stringify(json);
			init.method ??= "POST";
		}
		const req = new Request(`https://t.example.com${path}`, {
			...init,
			headers,
		});
		if (cf) Object.defineProperty(req, "cf", { value: cf });
		const pending: Promise<unknown>[] = [];
		const ctx = {
			waitUntil: (p: Promise<unknown>) => pending.push(p),
			passThroughOnException: () => {},
			props: {},
		};
		const res = await app.request(req, undefined, env, ctx as never);
		await Promise.all(pending);
		return res;
	}

	async function register(
		overrides: Partial<RegisterMessageRequest> = {},
	): Promise<RegisterMessageRequest> {
		const body: RegisterMessageRequest = {
			id: "msg0000000000000000001",
			provider: "gmail",
			subject: "Hello",
			recipients: [{ email: "a@example.com" }],
			links: ["https://example.com/a", "https://example.com/b"],
			mode: "shared",
			trackOpens: true,
			trackLinks: true,
			...overrides,
		};
		const res = await request("/api/messages", { json: body });
		if (res.status !== 201) throw new Error(`register failed ${res.status}`);
		return body;
	}

	async function markSent(
		id: string,
		sentAt: number,
		providerThreadId?: string,
	) {
		const res = await request(`/api/messages/${id}/sent`, {
			json: { sentAt, ...(providerThreadId ? { providerThreadId } : {}) },
		});
		if (res.status !== 200) throw new Error(`markSent failed ${res.status}`);
	}

	const open = (id: string, opts: ReqOptions = {}) =>
		request(`/o/${id}.gif`, { ua: CHROME_UA, ip: "203.0.113.9", ...opts });

	return { app, store, clock, env, request, register, markSent, open };
}
