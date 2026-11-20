/** Worker bindings. Secrets are set with `wrangler secret put`; vars live in wrangler.toml. */
export interface Env {
	DB: D1Database;
	/** Bearer token the extension sends on /api requests. */
	API_TOKEN: string;
	/** Salt mixed into IP hashes so stored hashes cannot be reversed by lookup. */
	IP_SALT: string;
	SEND_GRACE_SECONDS?: string;
	OWNER_WINDOW_SECONDS?: string;
	RETENTION_DAYS?: string;
	STORE_LOCATION?: string;
	/** Extra CORS origins, comma-separated (extension origins are always allowed). */
	ALLOWED_ORIGINS?: string;
}

export interface Config {
	sendGraceMs: number;
	ownerWindowMs: number;
	/** How long an owner's IP hash keeps suppressing direct opens. */
	ownerIpMemoryMs: number;
	retentionDays: number;
	storeLocation: boolean;
	allowedOrigins: string[];
}

const SECOND = 1000;
export const DAY = 86_400 * SECOND;

function num(value: string | undefined, fallback: number): number {
	const n = Number(value);
	return value !== undefined && value !== "" && Number.isFinite(n) && n >= 0
		? n
		: fallback;
}

export function readConfig(env: Env): Config {
	return {
		sendGraceMs: num(env.SEND_GRACE_SECONDS, 20) * SECOND,
		ownerWindowMs: num(env.OWNER_WINDOW_SECONDS, 45) * SECOND,
		ownerIpMemoryMs: 30 * DAY,
		retentionDays: num(env.RETENTION_DAYS, 180),
		storeLocation: env.STORE_LOCATION === "true",
		allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	};
}
