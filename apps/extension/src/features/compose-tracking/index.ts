import { newId } from "@bet/shared";
import { INDIVIDUAL_TOOLTIP } from "../../lib/copy";
import { allRecipients, uniqueRecipients } from "../../lib/recipients";
import type {
	ComposeSession,
	ToolbarControlState,
} from "../../providers/types";
import { ICONS } from "../../ui/icons";
import { type ComposeMode, getMode, nextMode, setMode } from "../compose-mode";
import {
	errorMessage,
	neverTrackReason,
	prepareTrackedMessage,
	trackingAvailable,
} from "../tracking";
import type { Feature, FeatureContext } from "../types";

export function controlState(
	mode: ComposeMode,
	configured: boolean,
): ToolbarControlState {
	if (!configured) {
		return {
			iconSvg: ICONS["eye-slash"],
			color: "#80868b",
			tooltip:
				"Email tracking isn't set up. Open the extension options to connect your tracker.",
		};
	}
	switch (mode) {
		case "off":
			return {
				iconSvg: ICONS["eye-slash"],
				color: "#80868b",
				tooltip: "Tracking off for this email (click to change)",
			};
		case "shared":
			return {
				iconSvg: ICONS.eye,
				color: "#1e8e3e",
				tooltip: "Tracking opens and clicks (click to change)",
			};
		case "individual":
			return {
				iconSvg: ICONS.users,
				color: "#1a73e8",
				tooltip: `Track each recipient. ${INDIVIDUAL_TOOLTIP} (click to change)`,
			};
	}
}

async function trackShared(ctx: FeatureContext, session: ComposeSession) {
	const mode = getMode(session, ctx.settings().defaultMode);
	if (mode === "off" || !trackingAvailable(ctx)) return "continue" as const;
	const recipients = uniqueRecipients(allRecipients(session.getRecipients()));
	if (recipients.length === 0) return "continue" as const;
	const blocked = neverTrackReason(ctx, recipients);
	if (blocked) {
		ctx.adapter.showNotice(blocked);
		return "continue" as const;
	}
	const id = newId();
	const prepared = prepareTrackedMessage(ctx, {
		id,
		html: session.getBodyHtml(),
		subject: session.getSubject(),
		recipients,
		mode: "shared",
	});
	try {
		await ctx.api.register(prepared.request);
	} catch (err) {
		// Don't block the email: send it untracked and say so.
		ctx.adapter.showNotice(
			`Sent without tracking: ${errorMessage(err)}`,
			"error",
		);
		return "continue" as const;
	}
	session.setBodyHtml(prepared.html);
	session.onSent((info) => {
		ctx.api.markSent(id, { sentAt: Date.now(), ...info }).catch((err) => {
			console.warn("[bet] markSent failed", err);
		});
	});
	return "continue" as const;
}

/** Compose control (Off / Track / Track each recipient) and shared tracking on send. */
export const composeTracking: Feature = {
	id: "compose-tracking",
	setup(ctx) {
		ctx.adapter.onCompose((session) => {
			setMode(session, ctx.settings().defaultMode);
			const state = () =>
				controlState(getMode(session, "shared"), trackingAvailable(ctx));
			const control = session.addToolbarControl({
				...state(),
				onClick: () => {
					if (!trackingAvailable(ctx)) {
						ctx.adapter.showNotice(
							"Open the Better Email Tracking options to connect your tracker.",
						);
						return;
					}
					setMode(session, nextMode(getMode(session, "shared")));
					control.update(state());
				},
			});
			session.onBeforeSend((s) => trackShared(ctx, s));
		});
	},
};
