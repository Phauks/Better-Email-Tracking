import { describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "./client";

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

describe("ApiClient", () => {
	it("surfaces the Worker's error message and code", async () => {
		const api = new ApiClient("https://t.example.com", "tok", (async () =>
			json(
				{ error: "Connect Gmail first", code: "no_connector" },
				409,
			)) as unknown as typeof fetch);
		const err = (await api.createNudge({} as never).then(
			() => null,
			(e: unknown) => e,
		)) as ApiError;
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(409);
		expect(err.code).toBe("no_connector");
		expect(err.message).toBe(
			"POST /api/nudges failed: 409 Connect Gmail first",
		);
	});

	it("turns a 409 lease answer into false", async () => {
		const api = new ApiClient("https://t.example.com", "tok", (async () =>
			json({ error: "leased" }, 409)) as unknown as typeof fetch);
		expect(await api.leaseCampaign("c", { runnerId: "r" } as never)).toBe(
			false,
		);
	});

	it("refuses to call without a Worker URL", async () => {
		await expect(new ApiClient("", "tok").listMessages()).rejects.toThrow(
			"Worker URL is not set",
		);
	});
});
