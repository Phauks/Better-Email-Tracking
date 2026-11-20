import type { Store } from "../../core/store/types";
import type { Env } from "../../env";
import type { TrackerModule } from "../../types";
import { d1FollowUps, type FollowUpService } from "../nudges/public";
import { createCampaignRoutes } from "./routes";
import { D1CampaignStore } from "./store/d1";
import type { CampaignStore } from "./store/types";

export interface CampaignsDeps {
	store(env: Env): CampaignStore;
	/** Follow-ups for sent copies, through the nudges feature's service interface. */
	followUps(env: Env, store: Store): FollowUpService;
}

export const defaultCampaignsDeps: CampaignsDeps = {
	store: (env) => new D1CampaignStore(env.DB),
	followUps: d1FollowUps,
};

/**
 * Mail merge campaigns. Sending happens in the extension; the Worker keeps the queue
 * and starts each sent copy's follow-up sequence when the campaign has a policy.
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
