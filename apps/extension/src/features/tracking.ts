import {
	instrumentHtml,
	type Recipient,
	type RegisterMessageRequest,
	type TrackingMode,
} from "@bet/shared";
import { shouldTrackLink } from "../lib/links";
import { blockedRecipients, formatRecipient } from "../lib/recipients";
import { isConfigured } from "../settings";
import type { FeatureContext } from "./types";

/** Shared helpers for features that send tracked mail (compose, individual send, mail merge). */
export function trackingAvailable(ctx: FeatureContext): boolean {
	return isConfigured(ctx.settings());
}

/** Returns a user-facing reason if any recipient is on the never-track list. */
export function neverTrackReason(
	ctx: FeatureContext,
	recipients: Recipient[],
): string | null {
	const blocked = blockedRecipients(
		recipients,
		ctx.settings().neverTrackDomains,
	);
	if (blocked.length === 0) return null;
	return `Not tracked: ${blocked.map(formatRecipient).join(", ")} is on your never-track list.`;
}

export interface PreparedMessage {
	html: string;
	request: RegisterMessageRequest;
}

/** Instruments a body for one tracked message and builds its registration request. */
export function prepareTrackedMessage(
	ctx: FeatureContext,
	args: {
		id: string;
		html: string;
		subject: string;
		recipients: Recipient[];
		mode: TrackingMode;
		groupId?: string;
	},
): PreparedMessage {
	const trackLinks = ctx.settings().trackLinks;
	const { html, links } = instrumentHtml(args.html, {
		messageId: args.id,
		urls: ctx.urls(),
		trackOpens: true,
		trackLinks,
		shouldTrackLink,
	});
	const request: RegisterMessageRequest = {
		id: args.id,
		provider: ctx.adapter.name,
		subject: args.subject,
		recipients: args.recipients,
		links,
		mode: args.mode,
		trackOpens: true,
		trackLinks,
	};
	if (args.groupId) request.groupId = args.groupId;
	return { html, request };
}

export function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
