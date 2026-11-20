import { newId } from "@bet/shared";
import { allRecipients, uniqueRecipients } from "../../lib/recipients";
import type { ComposeSession, SentInfo } from "../../providers/types";
import { getMode } from "../compose-mode";
import {
	errorMessage,
	neverTrackReason,
	prepareTrackedMessage,
	trackingAvailable,
} from "../tracking";
import type { Feature, FeatureContext } from "../types";
import {
	type CopyPlan,
	planIndividualSend,
	SHARED_REASON_NOTICE,
} from "./plan";

const SENT_TIMEOUT_MS = 60_000;
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends a compose and resolves with its ids once the client reports it sent. */
function sendAndWait(session: ComposeSession): Promise<SentInfo> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve({}), SENT_TIMEOUT_MS);
		session.onSent((info) => {
			clearTimeout(timer);
			resolve(info);
		});
		session.send();
	});
}

/** Opens one copy addressed to a single recipient, sends it, and marks it sent. */
async function sendCopy(
	ctx: FeatureContext,
	copy: PreparedCopy,
	subject: string,
): Promise<void> {
	const copySession = await ctx.adapter.openCompose({
		to: [copy.plan.recipient.email],
		subject,
		html: copy.html,
	});
	await settle(300); // let the client settle recipients/body before sending
	const info = await sendAndWait(copySession);
	ctx.api
		.markSent(copy.plan.id, { sentAt: Date.now(), ...info })
		.catch((err) => {
			console.warn("[bet] markSent failed", err);
		});
}

interface PreparedCopy {
	plan: CopyPlan;
	html: string;
}

async function maybeSplit(ctx: FeatureContext, session: ComposeSession) {
	if (getMode(session, ctx.settings().defaultMode) !== "individual")
		return "continue" as const;
	if (!trackingAvailable(ctx)) return "continue" as const;
	const recipients = uniqueRecipients(allRecipients(session.getRecipients()));
	// compose-tracking reports the never-track notice and sends untracked.
	if (neverTrackReason(ctx, recipients)) return "continue" as const;

	const plan = planIndividualSend(
		{
			recipients: session.getRecipients(),
			hasAttachments: session.hasAttachments(),
			isReply: session.isReply(),
		},
		newId,
	);
	if (plan.kind === "shared") {
		const notice = SHARED_REASON_NOTICE[plan.reason];
		if (notice) ctx.adapter.showNotice(notice);
		return "continue" as const; // compose-tracking applies shared tracking
	}

	const subject = session.getSubject();
	const baseHtml = session.getBodyHtml();
	const total = plan.copies.length;

	// Register every copy before sending any, so a tracker outage falls back to one normal send.
	let copies: PreparedCopy[];
	try {
		copies = await Promise.all(
			plan.copies.map(async (c) => {
				const prepared = prepareTrackedMessage(ctx, {
					id: c.id,
					html: baseHtml,
					subject,
					recipients: [c.recipient],
					mode: "individual",
					groupId: plan.groupId,
				});
				await ctx.api.register(prepared.request);
				return { plan: c, html: prepared.html };
			}),
		);
	} catch (err) {
		ctx.adapter.showNotice(
			`Couldn't set up per-recipient tracking, sending normally: ${errorMessage(err)}`,
			"error",
		);
		return "continue" as const;
	}

	ctx.adapter.showNotice(`Sending ${total} individual copies…`);
	let sent = 0;
	for (const copy of copies) {
		try {
			await sendCopy(ctx, copy, subject);
			sent++;
		} catch (err) {
			const remaining = copies.slice(sent).map((c) => c.plan.recipient.email);
			ctx.adapter.showNotice(
				`Sent ${sent} of ${total}. Not sent to: ${remaining.join(", ")}. The original draft is still open. (${errorMessage(err)})`,
				"error",
			);
			return "abort" as const;
		}
	}
	session.discard();
	ctx.adapter.showNotice(`Sent ${total} individually tracked copies.`);
	return "handled" as const;
}

/**
 * "Track each recipient": replaces one multi-recipient send with one tracked copy per
 * recipient, grouped by groupId. Must run before compose-tracking's before-send hook.
 */
export const individualSend: Feature = {
	id: "individual-send",
	setup(ctx) {
		ctx.adapter.onCompose((session) => {
			session.onBeforeSend((s) => maybeSplit(ctx, s));
		});
	},
};
