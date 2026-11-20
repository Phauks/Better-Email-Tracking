import { Hono } from "hono";
import type { Env } from "../../env";
import type { TrackerModule } from "../../types";
import { R2ObjectStore } from "./objects";
import { apiRoutes, type DocsEnv, viewerRoutes } from "./routes";
import { D1DocumentStore } from "./store/d1";
import type { DocumentStore, ObjectStore } from "./store/types";

/** Bindings this module adds on top of the core Env (see wrangler.toml). */
export interface DocumentsBindings {
	/** R2 bucket holding uploaded files. Uploads answer 503 until it is bound. */
	DOCS?: R2Bucket;
	/** Upload cap in megabytes (default 25). */
	DOCS_MAX_MB?: string;
}

export interface DocumentsDeps {
	store(env: Env): DocumentStore;
	objects(env: Env & DocumentsBindings): ObjectStore | null;
}

export const defaultDocumentsDeps: DocumentsDeps = {
	store: (env) => new D1DocumentStore(env.DB),
	objects: (env) => (env.DOCS ? new R2ObjectStore(env.DOCS) : null),
};

/** Document tracking: upload API, public viewer with per-page dwell, retention. */
export function createDocumentsModule(
	overrides: Partial<DocumentsDeps> = {},
): TrackerModule {
	const deps = { ...defaultDocumentsDeps, ...overrides };
	const withStores = new Hono<DocsEnv>();
	withStores.use("*", async (c, next) => {
		c.set("docs", deps.store(c.env));
		c.set("objects", deps.objects(c.env));
		await next();
	});
	return {
		name: "documents",
		register(app) {
			const api = new Hono<DocsEnv>()
				.route("/", withStores)
				.route("/", apiRoutes());
			const viewer = new Hono<DocsEnv>()
				.route("/", withStores)
				.route("/", viewerRoutes());
			app.route("/api/documents", api);
			app.route("/d", viewer);
		},
		async daily({ env, purgeBefore }) {
			if (purgeBefore === undefined) return;
			const docs = deps.store(env);
			const result = await docs.purgeBefore(purgeBefore);
			const keys = result.documents.map((d) => d.r2Key);
			if (keys.length) await deps.objects(env)?.delete(keys);
			console.log("document retention purge", {
				documents: keys.length,
				events: result.events,
			});
		},
	};
}

export const documentsModule = createDocumentsModule();
