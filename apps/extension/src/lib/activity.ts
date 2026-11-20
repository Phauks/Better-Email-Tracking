import type { FeedEvent } from "@bet/shared";
import { isMachineEvent } from "./feed";

/** Recent feed events kept in chrome.storage.local for the popup. */
export interface ActivityItem extends FeedEvent {
	seen: boolean;
}

export const ACTIVITY_LIMIT = 100;

/** Adds new events (newest first), dedupes by id, caps the list. */
export function mergeActivity(
	existing: ActivityItem[],
	incoming: FeedEvent[],
	markSeen: boolean,
): ActivityItem[] {
	const ids = new Set(existing.map((e) => e.id));
	const fresh = incoming
		.filter((e) => !e.ignored && !ids.has(e.id))
		.map((e) => ({ ...e, seen: markSeen }))
		.sort((a, b) => b.at - a.at);
	return [...fresh, ...existing].slice(0, ACTIVITY_LIMIT);
}

export function unseenCount(
	items: ActivityItem[],
	includeMachine: boolean,
): number {
	return items.filter((e) => !e.seen && (includeMachine || !isMachineEvent(e)))
		.length;
}

/** Which new events deserve a desktop notification. */
export function eventsToNotify(
	events: FeedEvent[],
	opts: { notify: boolean; notifyMachineOpens: boolean },
): FeedEvent[] {
	if (!opts.notify) return [];
	return events.filter(
		(e) => !e.ignored && (opts.notifyMachineOpens || !isMachineEvent(e)),
	);
}

export function badgeText(count: number): string {
	if (count <= 0) return "";
	return count > 99 ? "99+" : String(count);
}
