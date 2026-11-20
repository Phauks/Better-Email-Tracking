import type { ThreadStatus, ThreadStatusKind } from "@bet/shared";
import type { IconName } from "../ui/icons";
import { plural, relativeTime } from "./time";

export interface BadgeSpec {
	icon: IconName;
	color: string;
	tooltip: string;
}

export const STATUS_STYLE: Record<
	ThreadStatusKind,
	{ icon: IconName; color: string; label: string }
> = {
	unopened: { icon: "check", color: "#80868b", label: "Not opened yet" },
	machine_only: {
		icon: "check",
		color: "#bdc1c6",
		label: "Opened by a mail privacy proxy, may not be read",
	},
	opened: { icon: "checks", color: "#1e8e3e", label: "Opened" },
	clicked: { icon: "cursor-click", color: "#1a73e8", label: "Link clicked" },
};

const SHORT_LABEL: Record<ThreadStatusKind, string> = {
	unopened: "not opened",
	machine_only: "privacy proxy only",
	opened: "opened",
	clicked: "clicked",
};

/** Maps a thread's tracking status to the icon, color and tooltip shown in mail lists. */
export function badgeForStatus(
	status: ThreadStatus,
	now = Date.now(),
): BadgeSpec {
	const style = STATUS_STYLE[status.status];
	const lines = [style.label];
	if (status.replied) lines.push("Replied");
	const counts: string[] = [];
	if (status.opens > 0) counts.push(plural(status.opens, "open"));
	if (status.clicks > 0) counts.push(plural(status.clicks, "click"));
	if (counts.length) lines.push(counts.join(", "));
	if (status.lastEventAt)
		lines.push(`Last activity ${relativeTime(status.lastEventAt, now)}`);
	if (status.recipients?.length) {
		lines.push("");
		for (const r of status.recipients)
			lines.push(`${r.email}: ${SHORT_LABEL[r.status]}`);
	}
	return { icon: style.icon, color: style.color, tooltip: lines.join("\n") };
}
