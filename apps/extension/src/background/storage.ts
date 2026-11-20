import type { ActivityItem } from "../lib/activity";

/** Typed chrome.storage.local state owned by the background worker. */
interface LocalState {
	feedCursor?: number;
	activity?: ActivityItem[];
}

export async function getLocal<K extends keyof LocalState>(
	key: K,
): Promise<LocalState[K]> {
	const res = await chrome.storage.local.get(key);
	return res[key] as LocalState[K];
}

export async function setLocal(patch: LocalState): Promise<void> {
	await chrome.storage.local.set(patch);
}

export const ACTIVITY_KEY = "activity";
