/** Small text helpers shared by the Worker, the extension and the template renderers. */

const HTML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** "Ada Lovelace" -> "Ada"; "Lovelace, Ada" -> "Ada". */
export function firstName(name: string): string {
	const n = name.trim();
	if (n.includes(",")) return n.split(",")[1]?.trim().split(/\s+/)[0] ?? "";
	return n.split(/\s+/)[0] ?? "";
}
