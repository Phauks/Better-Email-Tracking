import type { Hono } from "hono";
import type { Config, Env } from "./env";
import type { Store } from "./store/types";

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

/**
 * A feature module. Core wiring (store, auth, CORS) is shared; a module adds routes
 * and, optionally, work for the daily cron. Register new ones in src/modules.ts.
 */
export interface TrackerModule {
	name: string;
	/** Mount routes. Anything under /api/* is already behind CORS and bearer auth. */
	register?(app: App): void;
	scheduled?(ctx: ScheduledContext): Promise<void>;
}
