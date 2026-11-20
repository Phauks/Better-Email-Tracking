import type { TrackerModule } from "../types";

/** Daily purge of messages, events and owner views older than RETENTION_DAYS. */
export const retentionModule: TrackerModule = {
	name: "retention",
	async daily({ store, purgeBefore }) {
		if (purgeBefore === undefined) return;
		const result = await store.purgeBefore(purgeBefore);
		console.log("retention purge", result);
	},
};
