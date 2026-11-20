import {
	type MessageSummary,
	statusFromCounts,
	strongestStatus,
	type ThreadStatusKind,
} from "@bet/shared";

export type StatusFilter = "all" | ThreadStatusKind;

export function messageStatus(m: MessageSummary): ThreadStatusKind {
	return statusFromCounts(m.opens, m.machineOpens, m.clicks);
}

export type DashboardEntry =
	| {
			kind: "single";
			key: string;
			message: MessageSummary;
			status: ThreadStatusKind;
			at: number;
	  }
	| {
			kind: "group";
			key: string;
			groupId: string;
			subject: string;
			messages: MessageSummary[];
			status: ThreadStatusKind;
			at: number;
	  };

/**
 * Collapses individual-send copies (same groupId) into one entry, newest first. Pages
 * loaded later merge into the groups already shown.
 */
export function groupMessages(messages: MessageSummary[]): DashboardEntry[] {
	const groups = new Map<string, MessageSummary[]>();
	const entries: DashboardEntry[] = [];
	for (const m of messages) {
		if (m.groupId) {
			const list = groups.get(m.groupId);
			if (list) list.push(m);
			else groups.set(m.groupId, [m]);
		} else {
			entries.push({
				kind: "single",
				key: m.id,
				message: m,
				status: messageStatus(m),
				at: m.sentAt ?? m.createdAt,
			});
		}
	}
	for (const [groupId, list] of groups) {
		list.sort((a, b) =>
			(a.recipients[0]?.email ?? "").localeCompare(
				b.recipients[0]?.email ?? "",
			),
		);
		entries.push({
			kind: "group",
			key: `g:${groupId}`,
			groupId,
			subject: list[0]?.subject ?? "",
			messages: list,
			status: list
				.map(messageStatus)
				.reduce(strongestStatus, "unopened" as ThreadStatusKind),
			at: Math.max(...list.map((m) => m.sentAt ?? m.createdAt)),
		});
	}
	return entries.sort((a, b) => b.at - a.at);
}
