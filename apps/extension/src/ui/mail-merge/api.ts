import { callMerge } from "../../features/mail-merge/messages";
import { DEFAULT_PROVIDER } from "../../providers/catalog";

/** Wakes open mail tabs so one starts sending. Resolves to how many answered. */
export async function dispatchToMailTabs(): Promise<number> {
	try {
		return (await callMerge({ type: "bet-merge:dispatch" })).tabs;
	} catch {
		return 0;
	}
}

const mail = DEFAULT_PROVIDER.label;

/** The provider new campaigns are sent from. */
export const MERGE_PROVIDER = DEFAULT_PROVIDER.name;

export const NO_MAIL_TAB = `No ${mail} tab is open. Open ${mail} in this browser and sending starts there automatically (keep the tab open).`;

export const SENDING_FROM_TAB = `Sending from your open ${mail} tab.`;
