/**
 * Builds the unpacked extension into dist/:
 *   1. extension pages (popup, options, dashboard) - normal Vite multi-page build
 *   2. content script - classic IIFE bundle (content scripts can't be ES modules)
 *   3. background service worker - single ES module
 *   4. manifest.json + InboxSDK's pageWorld.js
 * Usage: node scripts/build.mjs [--watch]
 */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { build } from "vite";
import { createManifest } from "./manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "dist");
const watch = process.argv.includes("--watch");
const mode = watch ? "development" : "production";
const require = createRequire(import.meta.url);

const common = {
	root,
	mode,
	configFile: false,
	logLevel: "warn",
	define: { "process.env.NODE_ENV": JSON.stringify(mode) },
};

async function buildPages() {
	await build({
		...common,
		base: "./",
		plugins: [svelte()],
		build: {
			outDir,
			emptyOutDir: true,
			sourcemap: watch ? "inline" : false,
			watch: watch ? {} : null,
			rollupOptions: {
				input: {
					popup: resolve(root, "popup.html"),
					options: resolve(root, "options.html"),
					dashboard: resolve(root, "dashboard.html"),
				},
			},
		},
	});
}

async function buildScript(entry, fileName, format) {
	await build({
		...common,
		publicDir: false,
		build: {
			outDir,
			emptyOutDir: false,
			copyPublicDir: false,
			sourcemap: watch ? "inline" : false,
			minify: !watch,
			watch: watch ? {} : null,
			lib: {
				entry: resolve(root, entry),
				name: "BetContent",
				formats: [format],
				fileName: () => fileName,
			},
		},
	});
}

async function writeManifestAndAssets() {
	const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
	const manifest = createManifest({ version: pkg.version });
	await writeFile(
		resolve(outDir, "manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	const sdkDir = dirname(require.resolve("@inboxsdk/core/package.json"));
	await copyFile(
		resolve(sdkDir, "pageWorld.js"),
		resolve(outDir, "pageWorld.js"),
	);
}

const checkAppId = async () => {
	const { loadEnv } = await import("vite");
	const env = loadEnv(mode, root, "VITE_");
	if (!env.VITE_INBOXSDK_APP_ID) {
		console.warn(
			"warning: VITE_INBOXSDK_APP_ID is not set; the Gmail integration won't load. See README.",
		);
	}
};

await checkAppId();
await buildPages();
await buildScript("src/content/index.ts", "content.js", "iife");
await buildScript("src/background/index.ts", "background.js", "es");
await writeManifestAndAssets();
console.log(`Built extension into ${outDir}${watch ? " (watching)" : ""}`);
