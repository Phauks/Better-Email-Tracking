import { extractPixelMessageId } from "@bet/shared";

/**
 * Finds our tracking pixels under a root (including Gmail-proxied srcs like
 * https://ci3.googleusercontent.com/...#https://t.example.com/o/ID.gif), removes them so
 * the owner's own view doesn't load them, and returns their message ids.
 */
export function stripOwnPixels(
	root: ParentNode | Element,
	trackerBase: string,
): string[] {
	if (!trackerBase) return [];
	const ids: string[] = [];
	const imgs: HTMLImageElement[] =
		root instanceof HTMLImageElement
			? [root]
			: Array.from(root.querySelectorAll("img"));
	for (const img of imgs) {
		const src = img.getAttribute("src") ?? "";
		const id = extractPixelMessageId(src, trackerBase);
		if (!id) continue;
		img.removeAttribute("src"); // cancel a pending load if there is one
		img.remove();
		ids.push(id);
	}
	return ids;
}
