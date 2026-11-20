import { badgeForStatus } from "../../lib/status-badge";
import type { ListRow } from "../../providers/types";
import { ICONS } from "../../ui/icons";
import { trackingAvailable } from "../tracking";
import type { Feature } from "../types";
import { ThreadStatusCache } from "./cache";

const REFRESH_MS = 60_000;

/** Status badges (unopened / privacy proxy / opened / clicked) on thread list rows. */
export const sentStatus: Feature = {
	id: "sent-status",
	setup(ctx) {
		const cache = new ThreadStatusCache(
			(ids) => ctx.api.threadStatus(ids),
			REFRESH_MS,
		);
		const live = new Map<ListRow, string>();

		const paint = async (row: ListRow, threadId: string) => {
			const status = await cache.get(threadId);
			if (!live.has(row)) return;
			if (!status) {
				row.setStatusBadge(null);
				return;
			}
			const spec = badgeForStatus(status);
			row.setStatusBadge({
				iconSvg: ICONS[spec.icon],
				color: spec.color,
				tooltip: spec.tooltip,
			});
		};

		ctx.adapter.onSentListRow((row) => {
			if (!trackingAvailable(ctx)) return;
			let destroyed = false;
			row.onDestroy(() => {
				destroyed = true;
				live.delete(row);
			});
			void row.getThreadId().then((threadId) => {
				if (!threadId || destroyed) return;
				live.set(row, threadId);
				void paint(row, threadId);
			});
		});

		setInterval(() => {
			if (live.size === 0 || document.hidden) return;
			cache.invalidate();
			for (const [row, threadId] of live) void paint(row, threadId);
		}, REFRESH_MS);
	},
};
