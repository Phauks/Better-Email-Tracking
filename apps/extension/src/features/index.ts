import { composeTracking } from "./compose-tracking";
import { documentTracking } from "./documents";
import { followUp } from "./follow-up";
import { individualSend } from "./individual-send";
import { mailMerge } from "./mail-merge";
import { ownOpen } from "./own-open";
import { sentStatus } from "./sent-status";
import type { Feature } from "./types";

/**
 * Every content-script feature, set up in this order. Order matters for compose
 * before-send hooks: individual-send must come before compose-tracking so it can take
 * over a send before shared tracking is applied. The rest add no before-send hooks:
 * documents only inserts links (instrumentation rewrites them per copy), mail merge
 * sends from its own queue, and follow-up listens for onTrackedSent. Order among them
 * only sets the order of their compose toolbar buttons.
 */
export const FEATURES: Feature[] = [
	individualSend,
	composeTracking,
	ownOpen,
	sentStatus,
	documentTracking,
	mailMerge,
	followUp,
];
