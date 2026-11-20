import { trackingUrls } from "@bet/shared";
import { FEATURES } from "../features";
import type { FeatureContext } from "../features/types";
import { createAdapterFor } from "../providers/registry";
import {
	DEFAULT_SETTINGS,
	loadSettings,
	type Settings,
	watchSettings,
} from "../settings";
import { backgroundApi } from "./api";

async function main(): Promise<void> {
	let settings: Settings = { ...DEFAULT_SETTINGS };
	try {
		settings = await loadSettings();
	} catch (err) {
		console.warn("[bet] could not load settings", err);
	}
	watchSettings((s) => {
		settings = s;
	});

	const adapter = await createAdapterFor(location.hostname);
	if (!adapter) return;

	const ctx: FeatureContext = {
		adapter,
		api: backgroundApi,
		settings: () => settings,
		urls: () => trackingUrls(settings.workerUrl),
	};

	for (const feature of FEATURES) {
		try {
			await feature.setup(ctx);
		} catch (err) {
			console.error(`[bet] feature ${feature.id} failed to start`, err);
		}
	}
}

main().catch((err) => console.error("[bet] content script failed", err));
