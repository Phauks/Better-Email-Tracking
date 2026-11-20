import { DAY } from "../env";
import type { TrackerModule } from "../types";

/** Daily purge of anything older than RETENTION_DAYS. */
export const retentionModule: TrackerModule = {
	name: "retention",
	async scheduled({ store, config, now }) {
		if (config.retentionDays <= 0) return;
		const result = await store.purgeBefore(now - config.retentionDays * DAY);
		console.log("retention purge", result);
	},
};
