import { Hono } from "hono";
import { type Env, readConfig } from "./env";
import { requireToken } from "./lib/auth";
import { apiCors } from "./lib/cors";
import { modules as defaultModules } from "./modules";
import { D1Store } from "./store/d1";
import type { App, AppDeps, AppEnv, TrackerModule } from "./types";

export const defaultDeps: AppDeps = {
	store: (env) => new D1Store(env.DB),
	now: () => Date.now(),
};

export function createApp(
	deps: Partial<AppDeps> = {},
	modules: TrackerModule[] = defaultModules,
): App {
	const { store, now } = { ...defaultDeps, ...deps };
	const app = new Hono<AppEnv>();

	app.use("*", async (c, next) => {
		c.set("config", readConfig(c.env));
		c.set("store", store(c.env));
		c.set("now", now);
		await next();
	});
	app.use("/api/*", apiCors);
	app.use("/api/*", requireToken);

	for (const m of modules) m.register?.(app);

	app.notFound((c) => c.text("Not found", 404));
	app.onError((err, c) => {
		console.error(err);
		return c.json({ error: "internal error" }, 500);
	});
	return app;
}

/** Runs every module's cron hook; one failing module does not stop the others. */
export async function runScheduled(
	env: Env,
	cron: string,
	deps: Partial<AppDeps> = {},
	modules: TrackerModule[] = defaultModules,
): Promise<void> {
	const { store, now } = { ...defaultDeps, ...deps };
	const ctx = {
		env,
		store: store(env),
		config: readConfig(env),
		now: now(),
		cron,
	};
	for (const m of modules) {
		if (!m.scheduled) continue;
		try {
			await m.scheduled(ctx);
		} catch (err) {
			console.error(`scheduled ${m.name} failed`, err);
		}
	}
}
