import type { Hono } from "hono";
import type { Store } from "./core/store/types";
import type { Config, Env } from "./env";

export interface AppVariables {
	store: Store;
	config: Config;
	now: () => number;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };
export type App = Hono<AppEnv>;

/** Injected collaborators. Production uses D1 and the wall clock; tests swap them. */
export interface AppDeps {
	store: (env: Env) => Store;
	now: () => number;
}

export interface ScheduledContext {
	env: Env;
	store: Store;
	config: Config;
	now: number;
	cron: string;
}

export interface DailyContext extends ScheduledContext {
	/** Delete data older than this (epoch ms). Undefined when retention is off. */
	purgeBefore?: number;
}

/**
 * A feature module. Core wiring (store, auth, CORS, cron) is shared; a module adds
 * routes and, optionally, cron work. Register new ones in src/modules.ts.
 */
export interface TrackerModule {
	name: string;
	/** Mount routes. Anything under /api/* is already behind CORS and bearer auth. */
	register?(app: App): void;
	/** Every cron run (every 15 minutes, see wrangler.toml). */
	scheduled?(ctx: ScheduledContext): Promise<void>;
	/** Once a day (see isDailyRun), before `scheduled`: retention purges and other housekeeping. */
	daily?(ctx: DailyContext): Promise<void>;
}
