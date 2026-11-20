import {
	type EventSource,
	type EventType,
	isLikelyHuman,
	statusFromCounts,
} from "@bet/shared";
import { describe, expect, it } from "vitest";
import { countEvents, HUMAN_SOURCES } from "../summary";
import { MemoryStore } from "./memory";
import type { StoredEvent } from "./types";

const SOURCES: EventSource[] = [
	"google_proxy",
	"apple_proxy",
	"scanner",
	"direct",
];
const TYPES: EventType[] = ["open", "click", "doc_view", "reply", "nudge_sent"];

let seed = 7;
const rnd = () => {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff;
	return seed / 0x7fffffff;
};
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)] as T;

/** The campaign stats loop as it was before the SQL aggregates (per-event). */
function previousGroupStats(
	messages: { id: string; sentAt?: number }[],
	events: StoredEvent[],
) {
	const s = { sent: 0, opened: 0, clicked: 0, machineOnly: 0, unopened: 0 };
	for (const m of messages) {
		if (m.sentAt === undefined) continue;
		s.sent++;
		const c = countEvents(events.filter((e) => e.messageId === m.id));
		const status = statusFromCounts(c.opens, c.machineOpens, c.clicks);
		if (status === "clicked") {
			s.clicked++;
			s.opened++;
		} else if (status === "opened") s.opened++;
		else if (status === "machine_only") s.machineOnly++;
		else s.unopened++;
	}
	return s;
}

describe("aggregates (the D1 SQL mirrors these; checked against real D1 in development)", () => {
	it("use the same human sources as the classifier", () => {
		for (const s of SOURCES)
			expect(isLikelyHuman(s)).toBe(
				(HUMAN_SOURCES as readonly string[]).includes(s),
			);
	});

	it("match the per-event computation for counts and group engagement", async () => {
		const store = new MemoryStore();
		const messages: { id: string; sentAt?: number }[] = [];
		for (let i = 0; i < 60; i++) {
			const id = `agg${String(i).padStart(19, "0")}`;
			const sent = i % 4 !== 0;
			await store.upsertMessage({
				id,
				provider: "gmail",
				subject: "s",
				recipients: [],
				mode: "individual",
				groupId: "group00000000000000001",
				...(i % 9 === 0 ? { kind: "nudge" as const } : {}),
				trackOpens: true,
				trackLinks: true,
				links: [],
				createdAt: i,
			});
			if (sent) await store.markSent(id, { sentAt: 100 + i });
			if (i % 9 !== 0) messages.push(sent ? { id, sentAt: 100 + i } : { id });
			for (let k = Math.floor(rnd() * 5); k > 0; k--)
				await store.insertEvent({
					messageId: id,
					type: pick(TYPES),
					source: pick(SOURCES),
					at: Math.floor(rnd() * 1e6),
					...(rnd() < 0.25 ? { ignored: "owner" as const } : {}),
				});
		}
		const counts = await store.countsForMessages(messages.map((m) => m.id));
		for (const m of messages) {
			const events = store.events.filter((e) => e.messageId === m.id);
			const expected = countEvents(events);
			if (events.some((e) => !e.ignored))
				expect(counts.get(m.id)).toEqual(expected);
			else expect(counts.has(m.id)).toBe(false);
		}
		const engagement = await store.groupEngagement(["group00000000000000001"]);
		expect(engagement.get("group00000000000000001")).toEqual(
			previousGroupStats(messages, store.events),
		);
	});
});
