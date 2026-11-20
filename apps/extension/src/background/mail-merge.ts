import {
	listenForMergeRequests,
	type MergeTabMessage,
	type WakeResponse,
} from "../features/mail-merge/messages";
import { workerApi as api } from "./api";

/** Mail client tabs: whatever the content script is injected into (provider-neutral). */
function mailTabPatterns(): string[] {
	return (
		chrome.runtime
			.getManifest()
			.content_scripts?.flatMap((cs) => cs.matches ?? []) ?? []
	);
}

/** Wakes every open mail tab; one of them takes the send lease. Returns how many answered. */
async function wakeMailTabs(): Promise<number> {
	const patterns = mailTabPatterns();
	if (patterns.length === 0) return 0;
	const tabs = await chrome.tabs.query({ url: patterns });
	const msg: MergeTabMessage = { type: "bet-merge:wake" };
	const answers = await Promise.all(
		tabs.map(async (t) => {
			if (t.id === undefined) return false;
			try {
				const res = (await chrome.tabs.sendMessage(t.id, msg)) as
					| WakeResponse
					| undefined;
				return res?.ok === true;
			} catch {
				return false; // no content script in that tab (yet)
			}
		}),
	);
	return answers.filter(Boolean).length;
}

/** Background side of mail merge: campaign API proxy for mail tabs, and waking them. */
export function startMailMergeBackground(): void {
	listenForMergeRequests({
		"bet-merge:list": async ({ status }) =>
			(await api()).listCampaigns(status ? { status } : {}),
		"bet-merge:get": async ({ id }) => (await api()).getCampaign(id),
		"bet-merge:lease": async ({ id, req }) =>
			(await api()).leaseCampaign(id, req),
		"bet-merge:result": async ({ id, email, req }) =>
			(await api()).recipientResult(id, email, req),
		"bet-merge:update": async ({ id, req }) =>
			(await api()).updateCampaign(id, req),
		"bet-merge:dispatch": async () => ({ tabs: await wakeMailTabs() }),
	});
}
