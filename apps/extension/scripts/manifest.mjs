/** MV3 manifest, generated into dist/ by scripts/build.mjs. */
export function createManifest({ version }) {
	return {
		manifest_version: 3,
		name: "Better Email Tracking",
		short_name: "Email Tracking",
		description: "Self-hosted open and click tracking for Gmail.",
		version,
		icons: {
			16: "icons/icon-16.png",
			32: "icons/icon-32.png",
			48: "icons/icon-48.png",
			128: "icons/icon-128.png",
		},
		action: {
			default_popup: "popup.html",
			default_title: "Email tracking",
			default_icon: {
				16: "icons/icon-16.png",
				32: "icons/icon-32.png",
			},
		},
		options_ui: { page: "options.html", open_in_tab: true },
		background: { service_worker: "background.js", type: "module" },
		// scripting: InboxSDK's background injects pageWorld.js into Gmail's main world.
		permissions: ["storage", "alarms", "notifications", "scripting"],
		host_permissions: ["https://mail.google.com/*"],
		// Your Worker's origin is requested at runtime; localhost is for `pnpm dev`.
		optional_host_permissions: [
			"https://*/*",
			"http://localhost/*",
			"http://127.0.0.1/*",
		],
		content_scripts: [
			{
				matches: ["https://mail.google.com/*"],
				js: ["content.js"],
				run_at: "document_end",
			},
		],
		web_accessible_resources: [
			{
				resources: ["pageWorld.js"],
				matches: ["https://mail.google.com/*"],
			},
		],
	};
}
