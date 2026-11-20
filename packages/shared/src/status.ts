import type { ThreadStatusKind } from "./api";

export function statusFromCounts(
	opens: number,
	machineOpens: number,
	clicks: number,
): ThreadStatusKind {
	if (clicks > 0) return "clicked";
	if (opens > 0) return "opened";
	if (machineOpens > 0) return "machine_only";
	return "unopened";
}

const RANK: Record<ThreadStatusKind, number> = {
	unopened: 0,
	machine_only: 1,
	opened: 2,
	clicked: 3,
};

export function strongestStatus(
	a: ThreadStatusKind,
	b: ThreadStatusKind,
): ThreadStatusKind {
	return RANK[a] >= RANK[b] ? a : b;
}
