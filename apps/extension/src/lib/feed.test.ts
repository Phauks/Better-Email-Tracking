import { describe, expect, it } from "vitest";
import {
	describeEvent,
	isMachineEvent,
	recipientLabel,
	SOURCE_LABEL,
	shortUrl,
} from "./feed";

describe("feed formatting", () => {
	it("labels sources", () => {
		expect(SOURCE_LABEL.google_proxy).toBe("Gmail proxy");
		expect(SOURCE_LABEL.apple_proxy).toBe("Apple privacy proxy (machine)");
		expect(isMachineEvent({ source: "apple_proxy" })).toBe(true);
		expect(isMachineEvent({ source: "google_proxy" })).toBe(false);
	});

	it("summarizes recipients", () => {
		expect(recipientLabel([])).toBe("Unknown recipient");
		expect(recipientLabel([{ email: "a@x.com", name: "Ana" }])).toBe("Ana");
		expect(recipientLabel([{ email: "a@x.com" }, { email: "b@x.com" }])).toBe(
			"a@x.com +1",
		);
	});

	it("describes opens, machine opens and clicks", () => {
		const base = { subject: "Plan", recipients: [{ email: "a@x.com" }] };
		expect(
			describeEvent({ ...base, type: "open", source: "direct" }).title,
		).toBe("a@x.com opened");
		expect(
			describeEvent({ ...base, type: "open", source: "apple_proxy" }).title,
		).toBe("a@x.com had a machine open");
		const click = describeEvent({
			...base,
			type: "click",
			source: "direct",
			linkUrl: "https://www.example.com/pricing",
		});
		expect(click.title).toBe("a@x.com clicked a link");
		expect(click.detail).toBe("Plan · example.com/pricing");
		expect(
			describeEvent({ ...base, subject: " ", type: "open", source: "direct" })
				.detail,
		).toBe("(no subject)");
	});

	it("shortens urls", () => {
		expect(shortUrl("not a url")).toBe("not a url");
		expect(shortUrl("https://example.com/")).toBe("example.com");
	});
});
