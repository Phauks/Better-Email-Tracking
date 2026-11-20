import { composeTracking } from "./compose-tracking";
import { individualSend } from "./individual-send";
import { ownOpen } from "./own-open";
import { sentStatus } from "./sent-status";
import type { Feature } from "./types";

/**
 * Every content-script feature, set up in this order. Order matters for compose
 * before-send hooks: individual-send must come before compose-tracking so it can take
 * over a send before shared tracking is applied. New modules (follow-up nudges,
 * document tracking, mail merge) slot in here.
 */
export const FEATURES: Feature[] = [
	individualSend,
	composeTracking,
	ownOpen,
	sentStatus,
];
