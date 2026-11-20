import { createApp, runScheduled } from "./app";
import type { Env } from "./env";

const app = createApp();

export default {
	fetch: app.fetch,
	scheduled(controller, env, ctx) {
		ctx.waitUntil(runScheduled(env, controller.cron));
	},
} satisfies ExportedHandler<Env>;
