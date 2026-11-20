import { API } from "@bet/shared";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import { safeEqual } from "./hash";

const PUBLIC_PATHS = new Set<string>([API.health]);

/** Bearer-token guard for /api/*. Refuses everything if API_TOKEN is unset. */
export const requireToken: MiddlewareHandler<AppEnv> = async (c, next) => {
	if (c.req.method === "OPTIONS" || PUBLIC_PATHS.has(c.req.path)) return next();
	const expected = c.env.API_TOKEN;
	const header = c.req.header("Authorization") ?? "";
	const match = /^Bearer\s+(.+)$/i.exec(header);
	if (
		!expected ||
		!match?.[1] ||
		!(await safeEqual(match[1].trim(), expected))
	) {
		return c.json({ error: "unauthorized" }, 401);
	}
	return next();
};
