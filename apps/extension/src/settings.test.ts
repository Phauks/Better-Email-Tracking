import { describe, expect, it } from "vitest";
import {
	DEFAULT_SETTINGS,
	isConfigured,
	isValidWorkerUrl,
	normalizeSettings,
	workerOriginPattern,
} from "./settings";

describe("settings", () => {
	it("fills defaults from empty storage", () => {
		expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
		expect(DEFAULT_SETTINGS.defaultMode).toBe("shared");
		expect(DEFAULT_SETTINGS.notifyMachineOpens).toBe(false);
	});
	it("drops bad values and normalizes", () => {
		const s = normalizeSettings({
			workerUrl: " https://t.example.com/ ",
			apiToken: 5,
			defaultMode: "weird",
			trackLinks: false,
			neverTrackDomains: ["@A.com", 3],
		});
		expect(s.workerUrl).toBe("https://t.example.com");
		expect(s.apiToken).toBe("");
		expect(s.defaultMode).toBe("shared");
		expect(s.trackLinks).toBe(false);
		expect(s.neverTrackDomains).toEqual(["a.com"]);
		expect(isConfigured(s)).toBe(false);
		expect(isConfigured({ ...s, apiToken: "x" })).toBe(true);
	});
	it("accepts HTTPS and local HTTP Worker URLs only", () => {
		expect(isValidWorkerUrl("https://t.example.com")).toBe(true);
		expect(isValidWorkerUrl("http://localhost:8787")).toBe(true);
		expect(isValidWorkerUrl("http://127.0.0.1:8787/")).toBe(true);
		expect(isValidWorkerUrl("http://t.example.com")).toBe(false);
		expect(isValidWorkerUrl("http://localhost.evil.com")).toBe(false);
	});
	it("builds the host permission pattern", () => {
		expect(workerOriginPattern("https://t.example.com/api")).toBe(
			"https://t.example.com/*",
		);
		expect(workerOriginPattern("nope")).toBeNull();
	});
});
