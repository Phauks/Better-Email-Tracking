import { apiModule } from "./core/api";
import { retentionModule } from "./core/retention";
import { trackingModule } from "./core/tracking";
import { campaignsModule } from "./features/campaigns";
import { documentsModule } from "./features/documents";
import { nudgesModule } from "./features/nudges";
import type { TrackerModule } from "./types";

/**
 * Every module, in registration order: core message tracking first, then features.
 * To add a feature, create src/features/<name>/index.ts exporting a TrackerModule and
 * append it here (see ARCHITECTURE.md).
 */
export const modules: TrackerModule[] = [
	trackingModule,
	apiModule,
	retentionModule,
	documentsModule,
	campaignsModule,
	nudgesModule,
];
