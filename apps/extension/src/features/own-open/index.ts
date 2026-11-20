import type { Feature, FeatureContext } from "../types";
import { stripOwnPixels } from "./pixels";

function createReporter(ctx: FeatureContext) {
	const reported = new Set<string>();
	let pending = new Set<string>();
	let scheduled = false;
	return (ids: string[]) => {
		for (const id of ids) if (!reported.has(id)) pending.add(id);
		if (pending.size === 0 || scheduled) return;
		scheduled = true;
		queueMicrotask(() => {
			scheduled = false;
			const batch = [...pending];
			pending = new Set();
			for (const id of batch) reported.add(id);
			ctx.api.ownerViews(batch).catch((err) => {
				for (const id of batch) reported.delete(id);
				console.warn("[bet] owner-views failed", err);
			});
		});
	};
}

/**
 * Keeps the owner's own reads out of the stats: when a message containing our pixel is
 * shown, report it as an owner view right away (the Worker ignores hits shortly after)
 * and remove the pixel. A MutationObserver catches pixels rendered outside message views.
 */
export const ownOpen: Feature = {
	id: "own-open",
	setup(ctx) {
		const report = createReporter(ctx);
		const base = () => ctx.settings().workerUrl;

		ctx.adapter.onMessageView((view) => {
			// Every copy of our pixel in the owner's mailbox is the owner viewing it
			// (their sent mail, or a reply quoting it), so scan all message views.
			report(stripOwnPixels(view.bodyElement, base()));
		});

		const observer = new MutationObserver((mutations) => {
			const trackerBase = base();
			if (!trackerBase) return;
			for (const m of mutations) {
				if (m.type === "attributes" && m.target instanceof HTMLImageElement) {
					report(stripOwnPixels(m.target, trackerBase));
				}
				for (const node of m.addedNodes) {
					if (node instanceof Element)
						report(stripOwnPixels(node, trackerBase));
				}
			}
		});
		observer.observe(ctx.adapter.getRootElement(), {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["src"],
		});
	},
};
