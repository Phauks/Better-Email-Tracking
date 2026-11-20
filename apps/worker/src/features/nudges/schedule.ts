import type { SendWindow } from "@bet/shared";

const HOUR = 3_600_000;
const MINUTE = 60_000;

export const LEASE_MS = 10 * MINUTE;
export const MAX_ATTEMPTS = 6;
/** Sequences handled per cron run (each needs one or two Gmail calls). */
export const BATCH_LIMIT = 25;

/** 15m, 30m, 1h, 2h, 4h… capped at 12h. */
export function backoffMs(attempts: number): number {
	return Math.min(12 * HOUR, 15 * MINUTE * 2 ** Math.max(0, attempts - 1));
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
	let f = formatters.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hour: "numeric",
			hourCycle: "h23",
			weekday: "short",
		});
		formatters.set(timeZone, f);
	}
	return f;
}

export function isValidTimeZone(tz: string): boolean {
	try {
		formatter(tz);
		return true;
	} catch {
		return false;
	}
}

/** Local hour (0-23) and whether it's Saturday/Sunday, in the window's time zone. */
export function localTime(
	at: number,
	timeZone = "UTC",
): { hour: number; weekend: boolean } {
	const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
	const parts = formatter(tz).formatToParts(new Date(at));
	const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
	const day = parts.find((p) => p.type === "weekday")?.value ?? "";
	return { hour, weekend: day === "Sat" || day === "Sun" };
}

export function inSendWindow(at: number, win: SendWindow | undefined): boolean {
	if (!win) return true;
	const { hour, weekend } = localTime(at, win.timeZone);
	if (win.weekdaysOnly && weekend) return false;
	return hour >= win.startHour && hour < win.endHour;
}

/**
 * The earliest time at or after `at` inside the window. Steps through whole UTC
 * hours, which also lands inside the window for half-hour offset zones.
 */
export function nextAllowed(at: number, win: SendWindow | undefined): number {
	if (!win || inSendWindow(at, win)) return at;
	let t = Math.ceil(at / HOUR) * HOUR;
	for (let i = 0; i < 8 * 24; i++, t += HOUR) {
		if (inSendWindow(t, win)) return t;
	}
	return at; // a window that never opens: don't stall the sequence
}
