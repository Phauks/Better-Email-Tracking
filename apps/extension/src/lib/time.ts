/** "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function relativeTime(at: number, now = Date.now()): string {
	const s = Math.max(0, Math.round((now - at) / 1000));
	if (s < 45) return "just now";
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.round(h / 24);
	if (d < 7) return `${d}d ago`;
	return new Date(at).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

export function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}
