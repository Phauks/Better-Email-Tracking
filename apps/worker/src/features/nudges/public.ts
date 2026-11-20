import type { Store } from "../../core/store/types";
import type { Env } from "../../env";
import { createFollowUpService, type FollowUpService } from "./service";
import { D1NudgeStore } from "./store/d1";

/**
 * What other features may use from follow-ups: the FollowUpService interface and the
 * policy parser. Everything else in this folder (store, runner, routes) is private.
 */
export type {
	FollowUpService,
	SequenceSpec,
	StartFollowUp,
	StartFollowUpResult,
} from "./service";
export { createFollowUpService } from "./service";
export type { GroupAction, GroupSequenceStats } from "./store/types";
export { parseFollowUpPolicy } from "./validate";

/** The production service: D1 nudge store plus the request's core store. */
export function d1FollowUps(env: Env, store: Store): FollowUpService {
	return createFollowUpService({ nudges: new D1NudgeStore(env.DB), store });
}
