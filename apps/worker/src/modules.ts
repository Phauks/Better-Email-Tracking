import { campaignsModule } from "./campaigns";
import { documentsModule } from "./documents";
import { nudgesModule } from "./nudges/module";
import { apiModule } from "./routes/api";
import { trackingModule } from "./routes/tracking";
import { retentionModule } from "./services/retention";
import type { TrackerModule } from "./types";

/**
 * Feature modules, in registration order. To add a feature (document tracking,
 * follow-up nudges, mail merge), create a module and append it here.
 */
export const modules: TrackerModule[] = [
	trackingModule,
	apiModule,
	retentionModule,
	documentsModule,
	campaignsModule,
	nudgesModule,
];
