import type { ConnectorStatus } from "@bet/shared";
import { mount, unmount } from "svelte";
import {
	buildNudgeRequest,
	describePolicy,
	type FollowUpChoice,
	resolveChoice,
	sendWindowFor,
} from "../../lib/nudges";
import { allRecipients, uniqueRecipients } from "../../lib/recipients";
import { callBackground } from "../../messaging";
import type {
	ComposeSession,
	ToolbarControlState,
	ToolbarPopover,
} from "../../providers/types";
import { ICONS } from "../../ui/icons";
import { getMode } from "../compose-mode";
import { onTrackedSent } from "../sent-events";
import { errorMessage, trackingAvailable } from "../tracking";
import type { Feature, FeatureContext } from "../types";
import FollowUpPopover from "./FollowUpPopover.svelte";

const choices = new WeakMap<ComposeSession, FollowUpChoice>();

export function followUpControlState(
	choice: FollowUpChoice,
	ctx: FeatureContext,
): ToolbarControlState {
	const resolved = resolveChoice(choice, ctx.settings().nudges);
	if (!resolved) {
		return {
			iconSvg: ICONS.alarm,
			color: "#80868b",
			tooltip: "Follow up if no reply: off (click to set up)",
		};
	}
	return {
		iconSvg: ICONS["alarm-fill"],
		color: "#e37400",
		tooltip: `Follow up if no reply: ${describePolicy(resolved.policy)} (click to change)`,
	};
}

/** Used when a provider can't anchor a popover to its toolbar button. */
function floatingPopover(): ToolbarPopover {
	const el = document.createElement("div");
	Object.assign(el.style, {
		position: "fixed",
		right: "24px",
		bottom: "88px",
		zIndex: "2147483000",
		boxShadow: "0 4px 16px rgba(0,0,0,.25)",
		borderRadius: "8px",
		overflow: "hidden",
	});
	document.body.append(el);
	const closers: (() => void)[] = [];
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") close();
	};
	const close = () => {
		if (!el.isConnected) return;
		el.remove();
		document.removeEventListener("keydown", onKey);
		for (const cb of closers) cb();
	};
	document.addEventListener("keydown", onKey);
	return { el, close, onClose: (cb) => closers.push(cb) };
}

let connectorCache: { at: number; value: ConnectorStatus | null } | null = null;

async function loadConnector(): Promise<ConnectorStatus | null> {
	if (
		connectorCache?.value?.connected &&
		Date.now() - connectorCache.at < 60_000
	)
		return connectorCache.value;
	const res = await callBackground({ type: "bet:connectorStatus" });
	const value = res.connectors.find((c) => c.kind === "google") ?? null;
	connectorCache = { at: Date.now(), value };
	return value;
}

function openPopover(
	ctx: FeatureContext,
	session: ComposeSession,
	popover: ToolbarPopover,
	refresh: () => void,
): void {
	const app = mount(FollowUpPopover, {
		target: popover.el,
		props: {
			initial: choices.get(session) ?? { kind: "off" },
			defaults: ctx.settings().nudges,
			recipients: uniqueRecipients(allRecipients(session.getRecipients())),
			trackingOff:
				!trackingAvailable(ctx) ||
				getMode(session, ctx.settings().defaultMode) === "off",
			loadConnector,
			onchange: (choice: FollowUpChoice) => {
				choices.set(session, choice);
				refresh();
			},
			onopenoptions: () => {
				void callBackground({ type: "bet:openOptions" }).catch(() => {});
				popover.close();
			},
			onclose: () => popover.close(),
		},
	});
	popover.onClose(() => {
		void unmount(app);
	});
}

/** Summarises the outcome once per compose (individual sends create one sequence per copy). */
function reporter(ctx: FeatureContext) {
	const pending = new WeakMap<
		ComposeSession,
		{ ok: number; failed: string[]; timer: ReturnType<typeof setTimeout> }
	>();
	return (
		session: ComposeSession,
		result: { ok: true } | { error: string },
	) => {
		let entry = pending.get(session);
		if (!entry) {
			entry = {
				ok: 0,
				failed: [],
				timer: setTimeout(() => {
					const e = pending.get(session);
					pending.delete(session);
					if (!e) return;
					if (e.failed.length)
						ctx.adapter.showNotice(
							`Follow-up not scheduled: ${[...new Set(e.failed)].join("; ")}`,
							"error",
						);
					if (e.ok)
						ctx.adapter.showNotice(
							e.ok === 1
								? "Follow-up scheduled until they reply."
								: `${e.ok} follow-ups scheduled, one per recipient.`,
						);
				}, 4000),
			};
			pending.set(session, entry);
		}
		if ("error" in result) entry.failed.push(result.error);
		else entry.ok++;
	};
}

/**
 * "Follow up if no reply": a compose control to pick a nudge policy, and on send a
 * sequence per tracked message (per copy for individual sends) created on the Worker,
 * which sends the nudges from the owner's mailbox until someone replies.
 */
export const followUp: Feature = {
	id: "follow-up",
	setup(ctx) {
		const report = reporter(ctx);

		ctx.adapter.onCompose((session) => {
			choices.set(
				session,
				ctx.settings().nudges.enabledByDefault
					? { kind: "default" }
					: { kind: "off" },
			);
			const state = () =>
				followUpControlState(choices.get(session) ?? { kind: "off" }, ctx);
			const control = session.addToolbarControl({
				...state(),
				popover: true,
				onClick: (popover) => {
					if (!trackingAvailable(ctx)) {
						ctx.adapter.showNotice(
							"Open the Better Email Tracking options to connect your tracker.",
						);
						popover?.close();
						return;
					}
					openPopover(ctx, session, popover ?? floatingPopover(), () =>
						control.update(state()),
					);
				},
			});
		});

		onTrackedSent((sent) => {
			const choice = choices.get(sent.session);
			if (!choice) return;
			const defaults = ctx.settings().nudges;
			const resolved = resolveChoice(choice, defaults);
			if (!resolved) return;
			if (!sent.providerThreadId) {
				report(sent.session, {
					error: "the mail client didn't report the thread id",
				});
				return;
			}
			const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
			const req = buildNudgeRequest(
				sent,
				resolved,
				sendWindowFor(defaults, timeZone),
			);
			callBackground({ type: "bet:createNudge", req }).then(
				(res) => {
					if (res.ok) report(sent.session, { ok: true });
					else if (res.code === "no_connector") {
						connectorCache = null;
						report(sent.session, {
							error:
								"connect Gmail in the Better Email Tracking options (Follow-ups)",
						});
					} else report(sent.session, { error: res.error });
				},
				(err) => report(sent.session, { error: errorMessage(err) }),
			);
		});
	},
};
