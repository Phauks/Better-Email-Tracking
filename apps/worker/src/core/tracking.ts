import { isValidId, ROUTES } from "@bet/shared";
import { Hono } from "hono";
import { defer } from "../lib/defer";
import { gifResponse, NO_STORE_HEADERS } from "../lib/gif";
import { describeRequest } from "../lib/request";
import type { AppEnv, TrackerModule } from "../types";
import { recordEvent } from "./events";

const NOT_FOUND_HTML =
	'<!doctype html><meta charset="utf-8"><title>Link not found</title><p>This link is no longer available.</p>';

export const trackingRoutes = new Hono<AppEnv>();

/** Open pixel. Always a 1x1 GIF, whatever happens; recording runs after the response. */
trackingRoutes.get(ROUTES.pixel, (c) => {
	try {
		const file = c.req.param("file") ?? "";
		const id = file.endsWith(".gif") ? file.slice(0, -4) : file;
		if (isValidId(id)) {
			const { store, config } = c.var;
			const at = c.var.now();
			const req = c.req.raw;
			const salt = c.env.IP_SALT;
			defer(c, async () => {
				const message = await store.getMessage(id);
				if (!message?.trackOpens) return;
				const facts = await describeRequest(req, config, salt);
				await recordEvent(store, config, { message, type: "open", facts, at });
			});
		}
	} catch (err) {
		console.error("pixel", err);
	}
	return gifResponse();
});

/** Click redirect. Only ever redirects to a URL registered for that message and index. */
trackingRoutes.get(ROUTES.click, async (c) => {
	const id = c.req.param("id") ?? "";
	const idxRaw = c.req.param("idx") ?? "";
	const notFound = () => c.html(NOT_FOUND_HTML, 404, NO_STORE_HEADERS);
	if (!isValidId(id) || !/^\d{1,4}$/.test(idxRaw)) return notFound();
	const idx = Number(idxRaw);
	const { store, config } = c.var;
	let url: string | null = null;
	let message = null;
	try {
		[message, url] = await Promise.all([
			store.getMessage(id),
			store.getLink(id, idx),
		]);
	} catch (err) {
		console.error("click lookup", err);
		return notFound();
	}
	if (!message || !url || !/^https?:\/\//i.test(url)) return notFound();
	const at = c.var.now();
	const req = c.req.raw;
	const salt = c.env.IP_SALT;
	const found = message;
	defer(c, async () => {
		const facts = await describeRequest(req, config, salt);
		await recordEvent(store, config, {
			message: found,
			type: "click",
			linkIndex: idx,
			facts,
			at,
		});
	});
	for (const [k, v] of Object.entries(NO_STORE_HEADERS)) c.header(k, v);
	c.header("Referrer-Policy", "no-referrer");
	return c.redirect(url, 302);
});

export const trackingModule: TrackerModule = {
	name: "tracking",
	register(app) {
		app.route("/", trackingRoutes);
	},
};
