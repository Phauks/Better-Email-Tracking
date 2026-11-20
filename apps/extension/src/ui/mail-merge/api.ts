import { type CampaignClient, campaignClient } from "../../api/campaigns";
import { callMerge } from "../../features/mail-merge/messages";
import { loadSettings } from "../../settings";

/** Extension pages call the Worker directly (they have the host permission). */
export async function mergeApi(): Promise<CampaignClient> {
	return campaignClient(await loadSettings());
}

/** Wakes open mail tabs so one starts sending. Resolves to how many answered. */
export async function dispatchToMailTabs(): Promise<number> {
	try {
		return (await callMerge({ type: "bet-merge:dispatch" })).tabs;
	} catch {
		return 0;
	}
}

export const NO_MAIL_TAB =
	"No Gmail tab is open. Open Gmail in this browser and sending starts there automatically (keep the tab open).";
