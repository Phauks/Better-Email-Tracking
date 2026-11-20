import {
	type FeedEvent,
	isLikelyHuman,
	type MessageSummary,
	statusFromCounts,
	strongestStatus,
	type ThreadStatus,
	type ThreadStatusKind,
	type TrackingEvent,
} from "@bet/shared";
import type { StoredEvent, StoredMessage } from "./store/types";

export interface Counts {
	opens: number;
	machineOpens: number;
	clicks: number;
	firstOpenAt?: number;
	lastEventAt?: number;
}

/** Whether an event contributes to open/click counts. */
export function isCounted(e: StoredEvent): boolean {
	if (e.ignored) return false;
	// doc_view, nudge_sent and reply appear in feeds but are not opens/clicks.
	if (e.type !== "open" && e.type !== "click") return false;
	return e.type === "open" || e.source !== "scanner";
}

/**
 * opens = likely-human opens, machineOpens = other opens (Apple MPP, scanners),
 * clicks = clicks not from scanners. Owner/grace events never count.
 */
export function countEvents(events: StoredEvent[]): Counts {
	const c: Counts = { opens: 0, machineOpens: 0, clicks: 0 };
	for (const e of events) {
		if (!isCounted(e)) continue;
		if (e.type === "click") c.clicks++;
		else if (isLikelyHuman(e.source)) {
			c.opens++;
			if (c.firstOpenAt === undefined || e.at < c.firstOpenAt)
				c.firstOpenAt = e.at;
		} else c.machineOpens++;
		if (c.lastEventAt === undefined || e.at > c.lastEventAt)
			c.lastEventAt = e.at;
	}
	return c;
}

export function statusOf(c: Counts): ThreadStatusKind {
	return statusFromCounts(c.opens, c.machineOpens, c.clicks);
}

export function groupByMessage(
	events: StoredEvent[],
): Map<string, StoredEvent[]> {
	const map = new Map<string, StoredEvent[]>();
	for (const e of events) {
		const list = map.get(e.messageId);
		if (list) list.push(e);
		else map.set(e.messageId, [e]);
	}
	return map;
}

export function toSummary(
	m: StoredMessage,
	events: StoredEvent[],
): MessageSummary {
	const c = countEvents(events);
	const s: MessageSummary = {
		id: m.id,
		provider: m.provider,
		subject: m.subject,
		recipients: m.recipients,
		mode: m.mode,
		createdAt: m.createdAt,
		opens: c.opens,
		machineOpens: c.machineOpens,
		clicks: c.clicks,
	};
	if (m.groupId) s.groupId = m.groupId;
	if (m.sentAt !== undefined) s.sentAt = m.sentAt;
	if (m.providerThreadId) s.providerThreadId = m.providerThreadId;
	if (c.firstOpenAt !== undefined) s.firstOpenAt = c.firstOpenAt;
	if (c.lastEventAt !== undefined) s.lastEventAt = c.lastEventAt;
	return s;
}

/** Public shape of an event: the IP hash stays server-side. */
export function toTrackingEvent(e: StoredEvent): TrackingEvent {
	const { ipHash: _ipHash, ...rest } = e;
	return rest;
}

export function toFeedEvent(
	e: StoredEvent,
	m: StoredMessage,
	links: Map<string, string[]>,
): FeedEvent {
	const fe: FeedEvent = {
		...toTrackingEvent(e),
		subject: m.subject,
		recipients: m.recipients,
	};
	if (e.type === "click" && e.linkIndex !== undefined) {
		const url = links.get(m.id)?.[e.linkIndex];
		if (url) fe.linkUrl = url;
	}
	return fe;
}

/**
 * Status for one provider thread. Every message in the thread is aggregated with
 * strongestStatus. Individual-mode copies also list per-recipient statuses, covering
 * every copy in their send group (copies usually land in separate threads).
 */
export function threadStatus(
	threadMessages: StoredMessage[],
	groupMessages: StoredMessage[],
	eventsByMessage: Map<string, StoredEvent[]>,
): ThreadStatus {
	let status: ThreadStatusKind = "unopened";
	let opens = 0;
	let clicks = 0;
	let lastEventAt: number | undefined;
	for (const m of threadMessages) {
		const c = countEvents(eventsByMessage.get(m.id) ?? []);
		status = strongestStatus(status, statusOf(c));
		opens += c.opens;
		clicks += c.clicks;
		if (
			c.lastEventAt !== undefined &&
			(lastEventAt === undefined || c.lastEventAt > lastEventAt)
		)
			lastEventAt = c.lastEventAt;
	}
	const out: ThreadStatus = { status, opens, clicks };
	if (lastEventAt !== undefined) out.lastEventAt = lastEventAt;
	if (
		threadMessages.some((m) =>
			eventsByMessage.get(m.id)?.some((e) => e.type === "reply" && !e.ignored),
		)
	)
		out.replied = true;

	const individual = new Map<string, StoredMessage>();
	for (const m of threadMessages)
		if (m.mode === "individual") individual.set(m.id, m);
	const groups = new Set(
		[...individual.values()].map((m) => m.groupId).filter(Boolean),
	);
	for (const m of groupMessages)
		if (m.mode === "individual" && m.groupId && groups.has(m.groupId))
			individual.set(m.id, m);
	if (individual.size > 0) {
		const perEmail = new Map<
			string,
			{ email: string; status: ThreadStatusKind }
		>();
		const ordered = [...individual.values()].sort(
			(a, b) => a.createdAt - b.createdAt,
		);
		for (const m of ordered) {
			const st = statusOf(countEvents(eventsByMessage.get(m.id) ?? []));
			for (const r of m.recipients) {
				const key = r.email.toLowerCase();
				const prev = perEmail.get(key);
				perEmail.set(key, {
					email: prev?.email ?? r.email,
					status: strongestStatus(prev?.status ?? "unopened", st),
				});
			}
		}
		out.recipients = [...perEmail.values()];
	}
	return out;
}
