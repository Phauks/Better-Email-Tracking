import type { Env } from "../../env";
import type { TrackerModule } from "../../types";
import { createCampaignRoutes } from "./routes";
import { D1CampaignStore } from "./store/d1";
import type { CampaignStore } from "./store/types";

export interface CampaignsDeps {
	store(env: Env): CampaignStore;
}

export const defaultCampaignsDeps: CampaignsDeps = {
	store: (env) => new D1CampaignStore(env.DB),
};

/**
 * Mail merge campaigns. Sending happens in the extension; the Worker keeps the queue.
 * Routes: /api/campaigns. Daily: purges campaigns not updated within RETENTION_DAYS.
 */
export function createCampaignsModule(
	overrides: Partial<CampaignsDeps> = {},
): TrackerModule {
	const deps: CampaignsDeps = { ...defaultCampaignsDeps, ...overrides };
	return {
		name: "campaigns",
		register(app) {
			app.route("/api/campaigns", createCampaignRoutes(deps));
		},
		async daily({ env, purgeBefore }) {
			if (purgeBefore === undefined) return;
			const purged = await deps.store(env).purgeBefore(purgeBefore);
			console.log("campaign retention purge", { campaigns: purged });
		},
	};
}

export const campaignsModule = createCampaignsModule();
