import { describe, expect, it } from "vitest";
import {
	DEFAULT_SETTINGS,
	isConfigured,
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
	it("builds the host permission pattern", () => {
		expect(workerOriginPattern("https://t.example.com/api")).toBe(
			"https://t.example.com/*",
		);
		expect(workerOriginPattern("nope")).toBeNull();
	});
});
