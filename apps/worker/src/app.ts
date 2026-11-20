import { Hono } from "hono";
import { D1Store } from "./core/store/d1";
import { DAY, type Env, readConfig } from "./env";
import { requireToken } from "./lib/auth";
import { apiCors } from "./lib/cors";
import { modules as defaultModules } from "./modules";
import type {
	App,
	AppDeps,
	AppEnv,
	DailyContext,
	ScheduledContext,
	TrackerModule,
} from "./types";

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

/** A daily-only cron, if one is ever configured next to the frequent one. */
export const DAILY_CRON = "17 3 * * *";

/** True once per day: on DAILY_CRON, or the 03:00-03:14 UTC run of the 15-minute cron. */
export function isDailyRun(cron: string, now: number): boolean {
	if (cron === DAILY_CRON) return true;
	const d = new Date(now);
	return d.getUTCHours() === 3 && d.getUTCMinutes() < 15;
}

/**
 * The cron entry point. Runs every module's `daily` hook on the daily run, then every
 * `scheduled` hook. One failing hook does not stop the others.
 */
export async function runScheduled(
	env: Env,
	cron: string,
	deps: Partial<AppDeps> = {},
	modules: TrackerModule[] = defaultModules,
): Promise<void> {
	const { store, now } = { ...defaultDeps, ...deps };
	const config = readConfig(env);
	const ctx: ScheduledContext = {
		env,
		store: store(env),
		config,
		now: now(),
		cron,
	};
	const hooks: [string, () => Promise<void> | undefined][] = [];
	if (isDailyRun(cron, ctx.now)) {
		const daily: DailyContext =
			config.retentionDays > 0
				? { ...ctx, purgeBefore: ctx.now - config.retentionDays * DAY }
				: ctx;
		for (const m of modules)
			hooks.push([`daily ${m.name}`, () => m.daily?.(daily)]);
	}
	for (const m of modules)
		hooks.push([`scheduled ${m.name}`, () => m.scheduled?.(ctx)]);
	for (const [name, run] of hooks) {
		try {
			await run();
		} catch (err) {
			console.error(`${name} failed`, err);
		}
	}
}
