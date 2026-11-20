/**
 * Best-effort attachment detection in a Gmail compose. Gmail keeps a hidden
 * input[name="attach"] per uploaded file and renders attachment chips; inline images
 * pasted into the body are uploaded parts too. If the compose element looks unfamiliar
 * we return undefined so callers can treat it as "unknown".
 */
const ATTACHMENT_SELECTORS = [
	'input[name="attach"]',
	'[role="link"][aria-label^="Attachment"]',
	"div.dL", // Gmail attachment chip container (class name, may change)
];

export function detectGmailAttachments(
	composeEl: HTMLElement,
	bodyEl: HTMLElement | null,
): boolean | undefined {
	if (!composeEl.isConnected) return undefined;
	for (const sel of ATTACHMENT_SELECTORS) {
		if (composeEl.querySelector(sel)) return true;
	}
	if (bodyEl) {
		for (const img of bodyEl.querySelectorAll("img")) {
			const src = img.getAttribute("src") ?? "";
			// Inline uploads use blob:/data:/cid: or Gmail's attachment URLs.
			if (!/^https?:/i.test(src) || /[?&]view=att\b|[?&]attid=/.test(src))
				return true;
		}
	}
	// Without a body element we can't be sure the selectors still match Gmail's DOM.
	return bodyEl ? false : undefined;
}
