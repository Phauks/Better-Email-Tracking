import type { IgnoreReason } from "@bet/shared";
import { countEvents, statusOf } from "../summary";
import type {
	Counts,
	GroupEngagement,
	ListQuery,
	NewEvent,
	NewMessage,
	PurgeResult,
	SentInfo,
	Store,
	StoredEvent,
	StoredMessage,
} from "./types";

interface OwnerView {
	messageId: string;
	at: number;
	ipHash?: string;
}

const newestFirst = (a: StoredMessage, b: StoredMessage) =>
	b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** In-memory Store for tests and local experiments. Not for production. */
export class MemoryStore implements Store {
	readonly messages = new Map<string, StoredMessage>();
	readonly links = new Map<string, string[]>();
	readonly events: StoredEvent[] = [];
	readonly ownerViews: OwnerView[] = [];
	private nextEventId = 1;

	async upsertMessage(msg: NewMessage): Promise<void> {
		const { links, ...rest } = msg;
		const existing = this.messages.get(msg.id);
		const next: StoredMessage = { ...rest };
		if (existing) {
			next.createdAt = existing.createdAt;
			if (existing.sentAt !== undefined) next.sentAt = existing.sentAt;
			if (existing.providerThreadId)
				next.providerThreadId = existing.providerThreadId;
			if (existing.providerMessageId)
				next.providerMessageId = existing.providerMessageId;
		}
		this.messages.set(msg.id, next);
		this.links.set(msg.id, [...links]);
	}

	async markSent(id: string, info: SentInfo): Promise<boolean> {
		const msg = this.messages.get(id);
		if (!msg) return false;
		msg.sentAt = info.sentAt;
		if (info.providerThreadId) msg.providerThreadId = info.providerThreadId;
		if (info.providerMessageId) msg.providerMessageId = info.providerMessageId;
		return true;
	}

	async getMessage(id: string): Promise<StoredMessage | null> {
		const msg = this.messages.get(id);
		return msg ? { ...msg } : null;
	}

	async getLinks(id: string): Promise<string[]> {
		return [...(this.links.get(id) ?? [])];
	}

	async getLink(id: string, index: number): Promise<string | null> {
		return this.links.get(id)?.[index] ?? null;
	}

	async listMessages(query: ListQuery): Promise<StoredMessage[]> {
		const q = query.q?.toLowerCase();
		const after = query.after;
		return [...this.messages.values()]
			.filter((m) => m.kind !== "nudge")
			.filter(
				(m) =>
					!after ||
					m.createdAt < after.createdAt ||
					(m.createdAt === after.createdAt && m.id < after.id),
			)
			.filter((m) => !query.groupId || m.groupId === query.groupId)
			.filter(
				(m) =>
					!q ||
					m.subject.toLowerCase().includes(q) ||
					JSON.stringify(m.recipients).toLowerCase().includes(q),
			)
			.filter(
				(m) =>
					!query.status ||
					statusOf(countEvents(this.eventsOf(m.id))) === query.status,
			)
			.sort(newestFirst)
			.slice(0, query.limit)
			.map((m) => ({ ...m }));
	}

	async getMessagesByIds(ids: string[]): Promise<StoredMessage[]> {
		const set = new Set(ids);
		return [...this.messages.values()].filter((m) => set.has(m.id));
	}

	async getMessagesByThreadIds(threadIds: string[]): Promise<StoredMessage[]> {
		const set = new Set(threadIds);
		return [...this.messages.values()].filter(
			(m) => m.providerThreadId !== undefined && set.has(m.providerThreadId),
		);
	}

	async getMessagesByGroupIds(
		groupIds: string[],
		limit: number,
	): Promise<StoredMessage[]> {
		const set = new Set(groupIds);
		return [...this.messages.values()]
			.filter(
				(m) =>
					m.kind !== "nudge" && m.groupId !== undefined && set.has(m.groupId),
			)
			.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
			.slice(0, limit);
	}

	async deleteMessage(id: string): Promise<boolean> {
		const existed = this.messages.delete(id);
		this.links.delete(id);
		this.removeWhere(this.events, (e) => e.messageId === id);
		this.removeWhere(this.ownerViews, (v) => v.messageId === id);
		return existed;
	}

	async insertEvent(event: NewEvent): Promise<number> {
		const id = this.nextEventId++;
		this.events.push({ ...event, id });
		return id;
	}

	async getEventsForMessages(ids: string[]): Promise<StoredEvent[]> {
		const set = new Set(ids);
		return this.events.filter((e) => set.has(e.messageId));
	}

	async countsForMessages(ids: string[]): Promise<Map<string, Counts>> {
		const out = new Map<string, Counts>();
		for (const id of new Set(ids)) {
			const events = this.eventsOf(id).filter((e) => !e.ignored);
			if (events.length) out.set(id, countEvents(events));
		}
		return out;
	}

	async groupEngagement(
		groupIds: string[],
	): Promise<Map<string, GroupEngagement>> {
		const out = new Map<string, GroupEngagement>();
		const set = new Set(groupIds);
		for (const m of this.messages.values()) {
			if (m.kind === "nudge" || m.sentAt === undefined) continue;
			if (!m.groupId || !set.has(m.groupId)) continue;
			let g = out.get(m.groupId);
			if (!g) {
				g = { sent: 0, opened: 0, clicked: 0, machineOnly: 0, unopened: 0 };
				out.set(m.groupId, g);
			}
			g.sent++;
			const status = statusOf(countEvents(this.eventsOf(m.id)));
			if (status === "clicked") g.clicked++;
			if (status === "clicked" || status === "opened") g.opened++;
			else if (status === "machine_only") g.machineOnly++;
			else g.unopened++;
		}
		return out;
	}

	async getFeedEventsAfter(
		since: number,
		limit: number,
	): Promise<StoredEvent[]> {
		return this.events
			.filter((e) => !e.ignored && e.id > since)
			.slice(0, limit);
	}

	async getLatestFeedEvents(limit: number): Promise<StoredEvent[]> {
		const counted = this.events.filter((e) => !e.ignored);
		return counted.slice(Math.max(0, counted.length - limit));
	}

	async ignoreOpensSince(
		messageIds: string[],
		since: number,
		reason: IgnoreReason,
	): Promise<number> {
		const set = new Set(messageIds);
		let n = 0;
		for (const e of this.events) {
			if (
				set.has(e.messageId) &&
				e.type === "open" &&
				!e.ignored &&
				e.at >= since
			) {
				e.ignored = reason;
				n++;
			}
		}
		return n;
	}

	async recordOwnerViews(
		messageIds: string[],
		at: number,
		ipHash?: string,
	): Promise<void> {
		for (const messageId of messageIds) {
			this.ownerViews.push(
				ipHash ? { messageId, at, ipHash } : { messageId, at },
			);
		}
	}

	async lastOwnerViewAt(messageId: string): Promise<number | null> {
		let last: number | null = null;
		for (const v of this.ownerViews) {
			if (v.messageId === messageId && (last === null || v.at > last))
				last = v.at;
		}
		return last;
	}

	async ownerIpSeenSince(ipHash: string, since: number): Promise<boolean> {
		return this.ownerViews.some((v) => v.ipHash === ipHash && v.at >= since);
	}

	async purgeBefore(cutoff: number): Promise<PurgeResult> {
		const old = [...this.messages.values()].filter(
			(m) => (m.sentAt ?? m.createdAt) < cutoff,
		);
		for (const m of old) {
			this.messages.delete(m.id);
			this.links.delete(m.id);
		}
		const oldIds = new Set(old.map((m) => m.id));
		const events = this.removeWhere(
			this.events,
			(e) => e.at < cutoff || oldIds.has(e.messageId),
		);
		const ownerViews = this.removeWhere(
			this.ownerViews,
			(v) => v.at < cutoff || oldIds.has(v.messageId),
		);
		return { messages: old.length, events, ownerViews };
	}

	private eventsOf(messageId: string): StoredEvent[] {
		return this.events.filter((e) => e.messageId === messageId);
	}

	private removeWhere<T>(list: T[], pred: (item: T) => boolean): number {
		let removed = 0;
		for (let i = list.length - 1; i >= 0; i--) {
			if (pred(list[i] as T)) {
				list.splice(i, 1);
				removed++;
			}
		}
		return removed;
	}
}
