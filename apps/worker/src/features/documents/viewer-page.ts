import { escapeHtml, formatBytes } from "@bet/shared";

/** pdf.js from cdnjs, pinned to an exact version. Bump both URLs together. */
export const PDFJS_VERSION = "4.10.38";
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;
export const PDFJS_URL = `${CDN}/pdf.min.mjs`;
export const PDFJS_WORKER_URL = `${CDN}/pdf.worker.min.mjs`;

export interface ViewerConfig {
	name: string;
	size: number;
	pdf: boolean;
	/** Same-origin paths. */
	file: string;
	download: string;
	events: string;
}

/** JSON that is safe inside a <script> element. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export function viewerCsp(nonce: string): string {
	return [
		"default-src 'none'",
		`script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com 'wasm-unsafe-eval'`,
		// pdf.js wraps its cross-origin worker in a blob: module that imports it.
		"worker-src blob:",
		"connect-src 'self'",
		"img-src 'self' data: blob:",
		`style-src 'nonce-${nonce}'`,
		"font-src data:",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'",
	].join("; ");
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f1f3f4;--bar:#fff;--text:#202124;--muted:#5f6368;--border:#dadce0;--accent:#1a73e8;--page:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121416;--bar:#1f2226;--text:#e8eaed;--muted:#9aa0a6;--border:#3c4043;--accent:#8ab4f8;--page:#fff}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--bar);border-bottom:1px solid var(--border)}
header .name{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
header .pos{color:var(--muted);font-size:13px;white-space:nowrap}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;font-size:14px;white-space:nowrap}
@media (prefers-color-scheme:dark){.btn{color:#202124}}
.btn svg{width:18px;height:18px;fill:currentColor}
#pages{max-width:920px;margin:0 auto;padding:16px 12px 48px}
.page{position:relative;width:100%;margin:0 auto 14px;background:var(--page);border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,.25);aspect-ratio:1/1.4142;overflow:hidden}
.page canvas{display:block;width:100%;height:100%}
.card{max-width:420px;margin:12vh auto;padding:32px 24px;text-align:center;background:var(--bar);border:1px solid var(--border);border-radius:12px}
.card svg.doc{width:64px;height:64px;fill:var(--muted)}
.card h1{font-size:18px;margin:12px 0 4px;word-break:break-word}
.card p{color:var(--muted);margin:0 0 20px}
.msg{text-align:center;color:var(--muted);padding:40px 16px}
@media (max-width:520px){header{padding:8px 10px;gap:8px}.btn span{display:none}.btn{padding:8px 10px}#pages{padding:8px 0 32px}.page{margin-bottom:8px;border-radius:0}}
`;

// Phosphor (MIT): download-simple and file-text, regular weight.
const ICON_DOWNLOAD =
	'<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Zm-101.66,5.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,124.69V32a8,8,0,0,0-16,0v92.69L93.66,98.34a8,8,0,0,0-11.32,11.32Z"/></svg>';
const ICON_FILE =
	'<svg class="doc" viewBox="0 0 256 256" aria-hidden="true"><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Zm-32-80a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,136Zm0,32a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,168Z"/></svg>';

/**
 * Client script. Reports a 'view' once loaded, per-page dwell (only while the tab is
 * visible and the reader is active; flushed every 15s and with sendBeacon on hide),
 * and 'download' when the button is used. Renders PDFs lazily with pdf.js.
 */
const SCRIPT = `
const cfg = JSON.parse(document.getElementById("bet-cfg").textContent);
let viewId = null;
const pending = [];
function post(body, beacon) {
	const data = JSON.stringify(body);
	if (beacon && navigator.sendBeacon) {
		try { if (navigator.sendBeacon(cfg.events, new Blob([data], { type: "application/json" }))) return Promise.resolve(null); } catch {}
	}
	return fetch(cfg.events, { method: "POST", headers: { "Content-Type": "application/json" }, body: data, keepalive: true, credentials: "omit" })
		.then((r) => (r.ok ? r.json() : null)).catch(() => null);
}
function send(events, beacon) {
	if (!events.length) return;
	if (viewId === null) { pending.push(...events); return; }
	const body = { events };
	if (viewId) body.viewId = viewId;
	post(body, beacon);
}
function startView(pageCount) {
	const body = { events: [{ type: "view" }] };
	if (pageCount) body.pageCount = pageCount;
	post(body).then((r) => {
		viewId = r && typeof r.viewId === "number" ? r.viewId : 0;
		send(pending.splice(0), false);
	});
}
for (const a of document.querySelectorAll("[data-download]"))
	a.addEventListener("click", () => send([{ type: "download" }], true));

const dwell = new Map();
let current = 0;
let last = performance.now();
let lastActive = Date.now();
const IDLE_MS = 60000;
function tick() {
	const now = performance.now();
	const dt = Math.min(now - last, 5000);
	last = now;
	if (current && document.visibilityState === "visible" && Date.now() - lastActive < IDLE_MS)
		dwell.set(current, (dwell.get(current) || 0) + dt);
}
function flush(beacon) {
	tick();
	const events = [];
	for (const [page, ms] of dwell) if (ms >= 300) events.push({ type: "page", page, dwellMs: Math.round(ms) });
	dwell.clear();
	send(events, beacon);
}
for (const t of ["scroll", "wheel", "pointermove", "pointerdown", "touchstart", "keydown"])
	addEventListener(t, () => { lastActive = Date.now(); }, { passive: true, capture: true });
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "hidden") flush(true);
	else { last = performance.now(); lastActive = Date.now(); }
});
addEventListener("pagehide", () => flush(true));

async function showPdf() {
	const root = document.getElementById("pages");
	const pos = document.getElementById("pos");
	let pdf;
	try {
		const pdfjs = await import(${JSON.stringify(PDFJS_URL)});
		pdfjs.GlobalWorkerOptions.workerSrc = ${JSON.stringify(PDFJS_WORKER_URL)};
		pdf = await pdfjs.getDocument({ url: cfg.file, isEvalSupported: false, disableRange: true, withCredentials: false }).promise;
	} catch (err) {
		console.error(err);
		root.innerHTML = '<p class="msg">This document can\\'t be shown here. Use Download to open it.</p>';
		startView(0);
		return;
	}
	const n = pdf.numPages;
	startView(n);
	const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
	const ratio = first.width + " / " + first.height;
	const els = [];
	for (let i = 1; i <= n; i++) {
		const el = document.createElement("div");
		el.className = "page";
		el.dataset.page = String(i);
		el.style.aspectRatio = ratio;
		el.setAttribute("aria-label", "Page " + i);
		root.appendChild(el);
		els.push(el);
	}
	async function render(el) {
		if (el.dataset.rendered) return;
		el.dataset.rendered = "1";
		try {
			const page = await pdf.getPage(Number(el.dataset.page));
			const base = page.getViewport({ scale: 1 });
			el.style.aspectRatio = base.width + " / " + base.height;
			const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
			const vp = page.getViewport({ scale: (el.clientWidth / base.width) * dpr });
			const canvas = document.createElement("canvas");
			canvas.width = Math.floor(vp.width);
			canvas.height = Math.floor(vp.height);
			el.appendChild(canvas);
			await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
		} catch (err) { console.error(err); }
	}
	const near = new IntersectionObserver((entries) => {
		for (const e of entries) if (e.isIntersecting) render(e.target);
	}, { rootMargin: "1200px 0px" });
	const ratios = new Map();
	const seen = new IntersectionObserver((entries) => {
		for (const e of entries) ratios.set(Number(e.target.dataset.page), e.intersectionRatio);
		let best = 0, bestRatio = 0;
		for (const [p, r] of ratios) if (r > bestRatio) { best = p; bestRatio = r; }
		if (best && best !== current) { tick(); current = best; }
		if (best) pos.textContent = best + " / " + n;
	}, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
	for (const el of els) { near.observe(el); seen.observe(el); }
	setInterval(tick, 1000);
	setInterval(() => flush(false), 15000);
}

if (cfg.pdf) showPdf(); else startView(0);
`;

/** The viewer page for one document link. `nonce` must match viewerCsp(nonce). */
export function viewerHtml(cfg: ViewerConfig, nonce: string): string {
	const name = escapeHtml(cfg.name);
	const size = escapeHtml(formatBytes(cfg.size));
	const download = escapeHtml(cfg.download);
	const body = cfg.pdf
		? `<header><div class="name" title="${name}">${name}</div><div class="pos" id="pos"></div>
<a class="btn" href="${download}" data-download>${ICON_DOWNLOAD}<span>Download</span></a></header>
<main id="pages"><noscript><p class="msg">Turn on JavaScript to view this document, or use Download.</p></noscript></main>`
		: `<main class="card">${ICON_FILE}<h1>${name}</h1><p>${size}</p>
<a class="btn" href="${download}" data-download>${ICON_DOWNLOAD}<span>Download</span></a></main>`;
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${name}</title>
<style nonce="${nonce}">${STYLE}</style>
</head><body>
${body}
<script id="bet-cfg" type="application/json">${scriptJson(cfg)}</script>
<script type="module" nonce="${nonce}">${SCRIPT}</script>
</body></html>`;
}

export const DOC_NOT_FOUND_HTML =
	'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Document not found</title><p style="font-family:system-ui;text-align:center;margin-top:20vh">This document is no longer available.</p>';
