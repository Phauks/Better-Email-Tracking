import { describe, expect, it } from "vitest";
import {
	bodyToHtml,
	buildRecipients,
	detectDelimiter,
	escapeHtml,
	fieldKey,
	firstName,
	isValidEmail,
	parseAddress,
	parseCsv,
	parseCsvRecords,
	parseTemplate,
	previewMerge,
	renderMessage,
	renderTemplate,
	suggestMapping,
	templateFields,
	unknownFields,
} from "./index";

describe("parseCsvRecords", () => {
	it("splits simple rows and ignores a trailing newline", () => {
		expect(parseCsvRecords("a,b\n1,2\n").records).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	it("handles quotes, escaped quotes, delimiters and newlines inside quotes", () => {
		const csv = 'name,note\n"Lovelace, Ada","said ""hi""\nthen left"\n';
		expect(parseCsvRecords(csv).records).toEqual([
			["name", "note"],
			["Lovelace, Ada", 'said "hi"\nthen left'],
		]);
	});

	it("accepts CRLF, CR and LF endings and strips a BOM", () => {
		const csv = "﻿a,b\r\n1,2\r3,4\n5,6";
		expect(parseCsvRecords(csv).records).toEqual([
			["a", "b"],
			["1", "2"],
			["3", "4"],
			["5", "6"],
		]);
	});

	it("keeps empty fields, skips blank lines, trims unquoted values only", () => {
		expect(parseCsvRecords('a,,c\n\n\n x ," y "\n,').records).toEqual([
			["a", "", "c"],
			["x", " y "],
			["", ""],
		]);
	});

	it("reports an unterminated quote but keeps the data", () => {
		const r = parseCsvRecords('a,b\n1,"open');
		expect(r.records).toEqual([
			["a", "b"],
			["1", "open"],
		]);
		expect(r.errors).toHaveLength(1);
	});

	it("keeps stray quotes inside unquoted fields", () => {
		expect(parseCsvRecords('5" screen,x').records).toEqual([
			['5" screen', "x"],
		]);
	});

	it("detects semicolon and tab delimiters", () => {
		expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
		expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
		expect(detectDelimiter('"a;b",c\n')).toBe(",");
		expect(parseCsvRecords("a;b\n1;2").records[1]).toEqual(["1", "2"]);
	});
});

describe("parseCsv", () => {
	it("uses the first row as headers and de-duplicates them", () => {
		const t = parseCsv("Email, Name ,,Email\nx@y.com,X,1,2");
		expect(t.headers).toEqual(["Email", "Name", "Column 3", "Email 2"]);
		expect(t.rows).toEqual([["x@y.com", "X", "1", "2"]]);
	});

	it("returns an empty table for empty input", () => {
		expect(parseCsv("").headers).toEqual([]);
		expect(parseCsv("﻿\r\n").rows).toEqual([]);
	});
});

describe("mapping and recipients", () => {
	it("makes field keys", () => {
		expect(fieldKey(" First Name ")).toBe("first_name");
		expect(fieldKey("Société")).toBe("societe");
		expect(fieldKey("E-mail")).toBe("e_mail");
	});

	it("suggests email and name columns", () => {
		const m = suggestMapping(["Full Name", "E-mail", "Company"]);
		expect(m).toEqual({
			email: 1,
			name: 0,
			fields: ["name", "email", "company"],
		});
	});

	it("finds the email column by content when headers do not say", () => {
		const m = suggestMapping(["who", "addr2"], [["Ada", "ada@x.io"]]);
		expect(m.email).toBe(1);
	});

	it("validates addresses", () => {
		for (const ok of ["a@b.co", "a.b+tag@sub.example.org", "o'neil@x.ie"])
			expect(isValidEmail(ok)).toBe(true);
		for (const bad of [
			"",
			"a",
			"a@b",
			"a@@b.com",
			"a b@c.com",
			"a..b@c.com",
			"@b.com",
			"a@-b.com",
		])
			expect(isValidEmail(bad)).toBe(false);
		expect(parseAddress('"Ada L" <ada@x.io>')).toEqual({
			email: "ada@x.io",
			name: "Ada L",
		});
		expect(parseAddress("nope <x>")).toBeNull();
	});

	it("builds recipients: invalid, duplicate (case-insensitive) and empty rows are reported", () => {
		const t = parseCsv(
			"email,name,company\nada@x.io,Ada Lovelace,AE\nbad,Bob,B\nADA@x.io,Dup,D\n,,\nGrace <g@y.org>,,Navy",
		);
		const { recipients, issues } = buildRecipients(
			t,
			suggestMapping(t.headers),
		);
		expect(recipients).toEqual([
			{
				email: "ada@x.io",
				name: "Ada Lovelace",
				fields: {
					email: "ada@x.io",
					name: "Ada Lovelace",
					company: "AE",
					first_name: "Ada",
				},
			},
			{
				email: "g@y.org",
				name: "Grace",
				fields: {
					email: "g@y.org",
					name: "Grace",
					company: "Navy",
					first_name: "Grace",
				},
			},
		]);
		expect(issues).toEqual([
			{ row: 2, kind: "invalid_email", value: "bad" },
			{ row: 3, kind: "duplicate", value: "ADA@x.io" },
			{ row: 4, kind: "empty", value: "" },
		]);
	});

	it("respects ignored columns and an explicit first_name column", () => {
		const t = parseCsv("email,first name,secret\na@b.co,Al,s3");
		const { recipients } = buildRecipients(t, {
			email: 0,
			fields: ["email", "first_name", null],
		});
		expect(recipients[0]?.fields).toEqual({
			email: "a@b.co",
			first_name: "Al",
		});
	});

	it("derives first names", () => {
		expect(firstName("Ada Lovelace")).toBe("Ada");
		expect(firstName("Lovelace, Ada King")).toBe("Ada");
	});
});

describe("templates", () => {
	it("parses fields with fallbacks and leaves malformed tags as text", () => {
		expect(parseTemplate("Hi {{ First Name | there }}, {{}} {x}")).toEqual([
			{ kind: "text", value: "Hi " },
			{ kind: "field", name: "first_name", fallback: "there" },
			{ kind: "text", value: ", {{}} {x}" },
		]);
		expect(templateFields("{{a}} {{b|x}} {{A}}")).toEqual(["a", "b"]);
	});

	it("renders values, fallbacks and reports missing fields", () => {
		const r = renderTemplate("Hi {{first_name|there}} from {{company}}{{x}}", {
			company: "AE",
			first_name: "  ",
		});
		expect(r).toEqual({ output: "Hi there from AE", missing: ["x"] });
	});

	it("escapes values but not template markup in HTML", () => {
		const r = renderTemplate(
			'<b>{{name}}</b> <a href="https://x.io/?r={{ref}}">go</a>',
			{ name: "<script>&", ref: '"a' },
			{ html: true },
		);
		expect(r.output).toBe(
			'<b>&lt;script&gt;&amp;</b> <a href="https://x.io/?r=&quot;a">go</a>',
		);
		expect(escapeHtml("'")).toBe("&#39;");
	});

	it("turns plain text into <br> lines unless it has block markup", () => {
		expect(bodyToHtml("a\r\nb")).toBe("a<br>\nb");
		expect(bodyToHtml("<p>a</p>\n<p>b</p>")).toBe("<p>a</p>\n<p>b</p>");
	});

	it("renders a message with subject flattening and the block policy", () => {
		const tpl = {
			subject: "Hi {{name}}\n!",
			body: "Dear {{name}},\n{{offer}}",
		};
		const ok = renderMessage(tpl, { name: "Ada", offer: "<10% off>" }, "block");
		expect(ok).toEqual({
			subject: "Hi Ada !",
			html: "Dear Ada,<br>\n&lt;10% off&gt;",
			missing: [],
			blocked: false,
		});
		const missing = renderMessage(tpl, { name: "Bo" }, "block");
		expect(missing.blocked).toBe(true);
		expect(missing.missing).toEqual(["offer"]);
		expect(renderMessage(tpl, { name: "Bo" }, "warn").blocked).toBe(false);
	});

	it("previews every recipient and finds unknown fields", () => {
		const recipients = [
			{ email: "a@b.co", fields: { email: "a@b.co", name: "A" } },
			{ email: "c@d.co", fields: { email: "c@d.co" } },
		];
		const tpl = { subject: "{{name|friend}}", body: "{{nmae}}" };
		const rows = previewMerge(tpl, recipients, "warn");
		expect(rows.map((r) => r.subject)).toEqual(["A", "friend"]);
		expect(unknownFields(tpl, recipients)).toEqual(["nmae"]);
	});
});
