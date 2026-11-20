import { newId } from "@bet/shared";
import { sendCopy } from "../send-copy";
import {
	errorMessage,
	neverTrackReason,
	prepareTrackedMessage,
	trackingAvailable,
} from "../tracking";
import type { Feature, FeatureContext } from "../types";
import { callMerge, isWakeMessage, type WakeResponse } from "./messages";
import { campaignsToRun } from "./queue";
import { type RunnerDeps, runCampaign, type SendArgs } from "./runner";

/** How often an idle mail tab checks for campaigns to send (wake messages start it sooner). */
const IDLE_POLL_MS = 2 * 60_000;
const FIRST_CHECK_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One merged copy through the shared per-copy pipeline: instrument with its own
 * message id and groupId = campaign id, register, open a compose, send, wait for the
 * client to confirm, then mark the message sent.
 */
async function sendMergedCopy(
	ctx: FeatureContext,
	{ campaign, recipient, messageId, rendered }: SendArgs,
): Promise<{ confirmed: boolean }> {
	const to = {
		email: recipient.email,
		...(recipient.name ? { name: recipient.name } : {}),
	};
	if (neverTrackReason(ctx, [to])) {
		// On the never-track list: still send, without a pixel or tracked links.
		const r = await sendCopy(ctx, {
			to: recipient.email,
			subject: rendered.subject,
			html: rendered.html,
		});
		return { confirmed: r.confirmed };
	}
	const prepared = prepareTrackedMessage(ctx, {
		id: messageId,
		html: rendered.html,
		subject: rendered.subject,
		recipients: [to],
		mode: "individual",
		groupId: campaign.id,
		trackLinks: campaign.settings.trackLinks,
	});
	await ctx.api.register(prepared.request);
	const r = await sendCopy(ctx, {
		to: recipient.email,
		subject: rendered.subject,
		html: prepared.html,
	});
	// Only a confirmed send is marked sent; an unconfirmed one is reported as failed.
	if (r.confirmed) {
		const { confirmed: _c, ...info } = r;
		await ctx.api
			.markSent(messageId, { sentAt: Date.now(), ...info })
			.catch((err) => console.warn("[bet] markSent failed", err));
	}
	return { confirmed: r.confirmed };
}

function createRunner(ctx: FeatureContext) {
	const runnerId = newId();
	let running = false;

	const deps: RunnerDeps = {
		runnerId,
		makeId: newId,
		now: Date.now,
		sleep,
		send: (args) => sendMergedCopy(ctx, args),
		api: {
			get: (id) => callMerge({ type: "bet-merge:get", id }),
			lease: (id, req) => callMerge({ type: "bet-merge:lease", id, req }),
			result: (id, email, req) =>
				callMerge({ type: "bet-merge:result", id, email, req }),
			update: (id, req) => callMerge({ type: "bet-merge:update", id, req }),
		},
		onEvent(e) {
			if (e.kind === "failed")
				ctx.adapter.showNotice(
					`Mail merge: not sent to ${e.email}. ${e.error}`,
					"error",
				);
		},
	};

	/** Sends every campaign that is in the "sending" state, oldest first. */
	async function kick(): Promise<void> {
		if (running || !trackingAvailable(ctx)) return;
		running = true;
		try {
			const { campaigns } = await callMerge({
				type: "bet-merge:list",
				status: "sending",
			});
			for (const c of campaignsToRun(campaigns, ctx.adapter.name)) {
				ctx.adapter.showNotice(
					`Mail merge: sending "${c.name}". Keep this tab open; you can pause it from the dashboard.`,
				);
				const { outcome, sent } = await runCampaign(c.id, deps);
				const done = `Mail merge "${c.name}": ${sent} sent this run.`;
				if (outcome === "done")
					ctx.adapter.showNotice(`${done} Campaign complete.`);
				else if (outcome === "cap")
					ctx.adapter.showNotice(
						`${done} Paused at the per-run cap; resume it from the dashboard.`,
					);
				else if (outcome === "failing")
					ctx.adapter.showNotice(
						`${done} Paused after repeated failures.`,
						"error",
					);
				else if (outcome === "stopped" && sent > 0)
					ctx.adapter.showNotice(`${done} Stopped.`);
			}
		} catch (err) {
			console.warn("[bet] mail merge run failed", err);
			ctx.adapter.showNotice(
				`Mail merge stopped: ${errorMessage(err)}`,
				"error",
			);
		} finally {
			running = false;
		}
	}

	return { kick };
}

/**
 * Sends mail merge campaigns from this mail tab. The dashboard creates the campaign and
 * wakes open mail tabs through the background; the Worker's send lease lets only one tab
 * send. Queue state lives in the Worker, so a reload resumes where it stopped.
 */
export const mailMerge: Feature = {
	id: "mail-merge",
	setup(ctx) {
		const runner = createRunner(ctx);
		chrome.runtime.onMessage.addListener(
			(msg: unknown, _sender, sendResponse) => {
				if (!isWakeMessage(msg)) return false;
				void runner.kick();
				const res: WakeResponse = { ok: true, provider: ctx.adapter.name };
				sendResponse(res);
				return false;
			},
		);
		setTimeout(() => void runner.kick(), FIRST_CHECK_MS);
		setInterval(() => void runner.kick(), IDLE_POLL_MS);
	},
};
