import {
	type EventSource,
	isLikelyHuman,
	type Recipient,
	type TrackingEvent,
} from "@bet/shared";
import type { IconName } from "../ui/icons";

export const SOURCE_LABEL: Record<EventSource, string> = {
	google_proxy: "Gmail proxy",
	apple_proxy: "Apple privacy proxy (machine)",
	scanner: "Security scanner (machine)",
	direct: "Direct",
};

export function sourceIcon(source: EventSource): IconName {
	switch (source) {
		case "apple_proxy":
			return "shield-check";
		case "scanner":
			return "robot";
		case "google_proxy":
			return "globe";
		default:
			return "eye";
	}
}

export function isMachineEvent(e: Pick<TrackingEvent, "source">): boolean {
	return !isLikelyHuman(e.source);
}

export function recipientLabel(recipients: Recipient[]): string {
	if (recipients.length === 0) return "Unknown recipient";
	const first = recipients[0];
	const name = first?.name || first?.email || "";
	return recipients.length === 1 ? name : `${name} +${recipients.length - 1}`;
}

/** Human summary of one event, e.g. "Ana opened 'Quarterly plan'". */
export function describeEvent(e: {
	type: TrackingEvent["type"];
	source: EventSource;
	subject: string;
	recipients: Recipient[];
	linkUrl?: string;
}): { title: string; detail: string } {
	const who = recipientLabel(e.recipients);
	const subject = e.subject.trim() || "(no subject)";
	if (e.type === "click") {
		return {
			title: `${who} clicked a link`,
			detail: e.linkUrl ? `${subject} · ${shortUrl(e.linkUrl)}` : subject,
		};
	}
	const verb = isMachineEvent(e) ? "had a machine open" : "opened";
	return { title: `${who} ${verb}`, detail: subject };
}

export function shortUrl(url: string): string {
	try {
		const u = new URL(url);
		const path = u.pathname === "/" ? "" : u.pathname;
		const s = `${u.hostname.replace(/^www\./, "")}${path}`;
		return s.length > 48 ? `${s.slice(0, 47)}…` : s;
	} catch {
		return url;
	}
}

/** Device line from the event, if known (hidden behind Gmail/Apple proxies). */
export function deviceLabel(
	e: Pick<TrackingEvent, "device" | "location">,
): string {
	return [e.device, e.location].filter(Boolean).join(" · ");
}
