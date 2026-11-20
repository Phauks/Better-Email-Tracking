/**
 * Renders the extension's PNG icons from a Phosphor SVG with headless Chromium.
 * Output is committed under public/icons. Run: node scripts/icons.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const glyph = await readFile(
	require.resolve(
		"@phosphor-icons/core/assets/bold/envelope-simple-open-bold.svg",
	),
	"utf8",
);
const outDir = resolve(root, "public/icons");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
	// Small sizes get a tighter glyph so it stays legible.
	const pad = Math.round(size * (size <= 16 ? 0.1 : 0.18));
	const svg = glyph
		.replace(
			"<svg ",
			`<svg width="${size - pad * 2}" height="${size - pad * 2}" `,
		)
		.replace(/currentColor/g, "#ffffff");
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
		<div style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.22)}px;background:#1a73e8;display:grid;place-items:center">${svg}</div>
	</body></html>`);
	const png = await page.screenshot({
		omitBackground: true,
		clip: { x: 0, y: 0, width: size, height: size },
	});
	await writeFile(resolve(outDir, `icon-${size}.png`), png);
	console.log(`icon-${size}.png`);
}
await browser.close();
