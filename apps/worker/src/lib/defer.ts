import type { Context } from "hono";

/**
 * Run work after the response (ctx.waitUntil). Never throws: tracking endpoints must
 * answer even when recording fails.
 */
export function defer(c: Context, work: () => Promise<unknown>): void {
	const task = work().catch((err) => {
		console.error("deferred task failed", err);
	});
	try {
		c.executionCtx.waitUntil(task);
	} catch {
		// No execution context (e.g. some test harnesses): the task still runs.
	}
}
