import { DAY } from "../env";
import type { TrackerModule } from "../types";

/** The legacy daily cron. The 15-minute cron also purges in its 03:00 UTC slot. */
export const RETENTION_CRON = "17 3 * * *";

/** True once per day: on the daily cron, or the 03:00-03:14 UTC run of a frequent cron. */
export function isRetentionRun(cron: string, now: number): boolean {
	if (cron === RETENTION_CRON) return true;
	const d = new Date(now);
	return d.getUTCHours() === 3 && d.getUTCMinutes() < 15;
}

/** Daily purge of anything older than RETENTION_DAYS. */
export const retentionModule: TrackerModule = {
	name: "retention",
	async scheduled({ store, config, now, cron }) {
		if (config.retentionDays <= 0 || !isRetentionRun(cron, now)) return;
		const result = await store.purgeBefore(now - config.retentionDays * DAY);
		console.log("retention purge", result);
	},
};
