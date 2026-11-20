import type { FeedEvent } from "@bet/shared";
import { ApiClient } from "../api/client";
import {
	type ActivityItem,
	badgeText,
	eventsToNotify,
	mergeActivity,
	unseenCount,
} from "../lib/activity";
import { describeEvent } from "../lib/feed";
import { isConfigured, loadSettings, type Settings } from "../settings";
import { getLocal, setLocal } from "./storage";

export function apiFromSettings(s: Settings): ApiClient {
	return new ApiClient(s.workerUrl, s.apiToken);
}

let polling: Promise<void> | null = null;

/** Polls /api/feed from the stored cursor, stores activity, notifies, updates the badge. */
export function pollFeed(): Promise<void> {
	polling ??= doPoll().finally(() => {
		polling = null;
	});
	return polling;
}

async function doPoll(): Promise<void> {
	const settings = await loadSettings();
	if (!isConfigured(settings)) return;
	const api = apiFromSettings(settings);
	const cursor = await getLocal("feedCursor");
	const firstRun = cursor === undefined;
	const res = await api.feed(
		firstRun ? { limit: 50 } : { since: cursor, limit: 200 },
	);
	const activity = mergeActivity(
		(await getLocal("activity")) ?? [],
		res.events,
		firstRun,
	);
	await setLocal({ feedCursor: res.cursor ?? cursor, activity });
	if (!firstRun) await notify(eventsToNotify(res.events, settings));
	await refreshBadge(activity, settings);
}

export async function refreshBadge(
	activity?: ActivityItem[],
	settings?: Settings,
): Promise<void> {
	const items = activity ?? (await getLocal("activity")) ?? [];
	const s = settings ?? (await loadSettings());
	await chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
	await chrome.action.setBadgeText({
		text: badgeText(unseenCount(items, s.notifyMachineOpens)),
	});
}

export async function markAllSeen(): Promise<void> {
	const items = (await getLocal("activity")) ?? [];
	await setLocal({ activity: items.map((i) => ({ ...i, seen: true })) });
	await chrome.action.setBadgeText({ text: "" });
}

const ICON = "icons/icon-128.png";

async function notify(events: FeedEvent[]): Promise<void> {
	if (events.length === 0) return;
	if (events.length > 3) {
		await chrome.notifications.create(`bet-summary-${Date.now()}`, {
			type: "list",
			iconUrl: ICON,
			title: `${events.length} new opens and clicks`,
			message: "",
			items: events.slice(0, 5).map((e) => {
				const d = describeEvent(e);
				return { title: d.title, message: d.detail };
			}),
		});
		return;
	}
	for (const e of events) {
		const d = describeEvent(e);
		await chrome.notifications.create(`bet-msg-${e.messageId}-${e.id}`, {
			type: "basic",
			iconUrl: ICON,
			title: d.title,
			message: d.detail,
		});
	}
}
