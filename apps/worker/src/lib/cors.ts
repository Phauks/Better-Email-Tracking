import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "../types";

const EXTENSION_ORIGIN = /^(chrome|moz)-extension:\/\/[^/]+$/;

export function isAllowedOrigin(origin: string, extra: string[]): boolean {
	return EXTENSION_ORIGIN.test(origin) || extra.includes(origin);
}

export const apiCors: MiddlewareHandler<AppEnv> = (c, next) =>
	cors({
		origin: (origin) =>
			origin && isAllowedOrigin(origin, c.var.config.allowedOrigins)
				? origin
				: null,
		allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
		allowHeaders: ["Authorization", "Content-Type"],
		maxAge: 86_400,
	})(c, next);
