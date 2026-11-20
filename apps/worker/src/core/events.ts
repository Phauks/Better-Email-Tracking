import type { EventType, IgnoreReason } from "@bet/shared";
import type { Config } from "../env";
import type { RequestFacts } from "../lib/request";
import type { Store, StoredMessage } from "./store/types";

export interface RecordInput {
	message: StoredMessage;
	type: EventType;
	linkIndex?: number;
	facts: RequestFacts;
	at: number;
}

/**
 * Decides whether an event was caused by the sender themself. Such events are kept
 * (for the audit trail in MessageDetail) but flagged and excluded from counts.
 */
export async function suppressionReason(
	store: Store,
	config: Config,
	input: RecordInput,
): Promise<IgnoreReason | undefined> {
	const { message, facts, at } = input;
	// Right after sending, the sender's own client (or Gmail's proxy for it) fetches
	// the pixel. Before the send is confirmed, fall back to registration time.
	const sendTime = message.sentAt ?? message.createdAt;
	if (at < sendTime + config.sendGraceMs) return "send_grace";

	const lastView = await store.lastOwnerViewAt(message.id);
	if (
		lastView !== null &&
		at >= lastView &&
		at - lastView <= config.ownerWindowMs
	)
		return "owner";

	// A direct fetch from an IP the owner used recently is almost surely the owner.
	if (
		facts.source === "direct" &&
		facts.ipHash &&
		(await store.ownerIpSeenSince(facts.ipHash, at - config.ownerIpMemoryMs))
	)
		return "owner";
	return undefined;
}

export async function recordEvent(
	store: Store,
	config: Config,
	input: RecordInput,
): Promise<number> {
	const ignored = await suppressionReason(store, config, input);
	const { facts } = input;
	return store.insertEvent({
		messageId: input.message.id,
		type: input.type,
		...(input.linkIndex !== undefined ? { linkIndex: input.linkIndex } : {}),
		at: input.at,
		source: facts.source,
		...(facts.location ? { location: facts.location } : {}),
		...(facts.device ? { device: facts.device } : {}),
		...(facts.ipHash ? { ipHash: facts.ipHash } : {}),
		...(ignored ? { ignored } : {}),
	});
}
