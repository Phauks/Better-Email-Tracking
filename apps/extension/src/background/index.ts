// InboxSDK's MV3 background half: injects pageWorld.js into Gmail on request.
import "@inboxsdk/core/background.js";
import { listenForBgRequests } from "../messaging";
import { loadSettings } from "../settings";
import { apiFromSettings, markAllSeen, pollFeed, refreshBadge } from "./feed";
import { nudgeHandlers } from "./nudges";

const POLL_ALARM = "bet-poll-feed";

function ensureAlarm(): void {
	void chrome.alarms.get(POLL_ALARM).then((a) => {
		if (!a)
			void chrome.alarms.create(POLL_ALARM, {
				periodInMinutes: 1,
				delayInMinutes: 0.1,
			});
	});
}

chrome.runtime.onInstalled.addListener((details) => {
	ensureAlarm();
	if (details.reason === "install") void chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => {
	ensureAlarm();
	void refreshBadge();
});
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === POLL_ALARM)
		pollFeed().catch((err) => console.warn("[bet] poll failed", err));
});

chrome.notifications.onClicked.addListener((id) => {
	const m = /^bet-msg-([0-9A-Za-z]+)-/.exec(id);
	const hash = m ? `#message=${m[1]}` : "";
	void chrome.tabs.create({
		url: chrome.runtime.getURL(`dashboard.html${hash}`),
	});
	void chrome.notifications.clear(id);
});

const api = async () => apiFromSettings(await loadSettings());

listenForBgRequests({
	"bet:register": async ({ req }) => {
		await (await api()).registerMessage(req);
		return null;
	},
	"bet:markSent": async ({ id, req }) => {
		await (await api()).markSent(id, req);
		return null;
	},
	"bet:threadStatus": async ({ threadIds }) => {
		if (threadIds.length === 0) return { threads: {} };
		return (await api()).threadStatus(threadIds);
	},
	"bet:ownerViews": async ({ messageIds }) => {
		await (await api()).ownerViews({ messageIds });
		return null;
	},
	"bet:pollNow": async () => {
		await pollFeed();
		return null;
	},
	"bet:markSeen": async () => {
		await markAllSeen();
		return null;
	},
	...nudgeHandlers,
});

ensureAlarm();
