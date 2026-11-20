import type { FetchLike } from "../connectors/google-oauth";
import {
	type ConnectorResolver,
	resolveConnector,
} from "../connectors/registry";
import type { MailboxConnector } from "../connectors/types";
import { DAY } from "../env";
import { isRetentionRun } from "../services/retention";
import type { TrackerModule } from "../types";
import { type NudgeEnv, nudgeEnv } from "./env";
import { createNudgeRoutes } from "./routes";
import { runDueNudges } from "./runner";
import { D1NudgeStore } from "./store/d1";
import type { NudgeStore } from "./store/types";

export interface NudgeDeps {
	nudgeStore(env: NudgeEnv): NudgeStore;
	resolveConnector: ConnectorResolver;
	fetch: FetchLike;
}

export const defaultNudgeDeps: NudgeDeps = {
	nudgeStore: (env) => new D1NudgeStore(env.DB),
	resolveConnector,
	fetch: (...args) => fetch(...args),
};

/**
 * Follow-up nudges until reply. Routes: /api/nudges, /api/connectors, /oauth/google/callback.
 * Cron: every run sends due nudges; the daily retention slot also purges old finished
 * sequences.
 */
export function createNudgesModule(
	overrides: Partial<NudgeDeps> = {},
): TrackerModule {
	const deps: NudgeDeps = { ...defaultNudgeDeps, ...overrides };
	return {
		name: "nudges",
		register(app) {
			const { api, oauth } = createNudgeRoutes(deps);
			app.route("/api", api);
			app.route("/oauth", oauth);
		},
		async scheduled(ctx) {
			const env = nudgeEnv(ctx.env);
			const nudges = deps.nudgeStore(env);
			if (isRetentionRun(ctx.cron, ctx.now) && ctx.config.retentionDays > 0) {
				await nudges.purgeFinishedBefore(
					ctx.now - ctx.config.retentionDays * DAY,
				);
			}
			const live = new Map<string, Promise<MailboxConnector | null>>();
			const connector = (kind: string) => {
				let p = live.get(kind);
				if (!p) {
					p = nudges.getConnector(kind).then((record) =>
						record
							? deps.resolveConnector({
									env,
									record,
									fetch: deps.fetch,
									now: () => Date.now(),
								})
							: null,
					);
					live.set(kind, p);
				}
				return p;
			};
			const tally = await runDueNudges({
				store: ctx.store,
				nudges,
				now: ctx.now,
				connector,
			});
			if (Object.keys(tally).length) console.log("nudges", tally);
		},
	};
}

export const nudgesModule = createNudgesModule();
