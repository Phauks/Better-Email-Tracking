import {
	DEFAULT_MAX_DOCUMENT_BYTES,
	formatBytes,
	type UploadDocumentResponse,
} from "@bet/shared";
import {
	ATTACHMENT_HINT,
	bytesToBase64,
	documentLinkHtml,
	shouldHintAttachments,
} from "../../lib/documents";
import { callBackground } from "../../messaging";
import type {
	ComposeSession,
	ToolbarControlState,
} from "../../providers/types";
import { ICONS } from "../../ui/icons";
import { getMode } from "../compose-mode";
import { errorMessage, trackingAvailable } from "../tracking";
import type { Feature, FeatureContext } from "../types";

const HINT_POLL_MS = 2500;

const IDLE: ToolbarControlState = {
	iconSvg: ICONS["file-arrow-up"],
	color: "#5f6368",
	tooltip:
		"Attach tracked document: upload a file and insert a link. You'll see who opens it, which pages they read and for how long.",
};
const BUSY: ToolbarControlState = {
	iconSvg: ICONS["upload-simple"],
	color: "#1a73e8",
	tooltip: "Uploading tracked document…",
};
const HINTED: ToolbarControlState = { ...IDLE, color: "#e37400" };

/** Opens the system file picker; resolves null if the user cancels. */
function pickFile(): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.style.display = "none";
		const done = (file: File | null) => {
			input.remove();
			resolve(file);
		};
		input.addEventListener("change", () => done(input.files?.[0] ?? null));
		input.addEventListener("cancel", () => done(null));
		document.body.append(input);
		input.click();
	});
}

async function upload(file: File): Promise<UploadDocumentResponse> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	return callBackground({
		type: "bet:docUpload",
		name: file.name,
		mime: file.type,
		dataBase64: bytesToBase64(bytes),
	});
}

function insertLink(session: ComposeSession, html: string): void {
	if (session.insertHtmlAtCursor) session.insertHtmlAtCursor(html);
	else session.setBodyHtml(`${session.getBodyHtml()}${html}`);
}

/**
 * "Attach tracked document" compose control, and a one-time hint when a tracked
 * email carries normal attachments (those are delivered inside the email and can't
 * be tracked; their bytes are never read).
 */
export const documentTracking: Feature = {
	id: "documents",
	setup(ctx: FeatureContext) {
		ctx.adapter.onCompose((session) => {
			let busy = false;
			let hinted = false;
			const control = session.addToolbarControl({
				...IDLE,
				onClick: async () => {
					if (busy) return;
					if (!trackingAvailable(ctx)) {
						ctx.adapter.showNotice(
							"Open the Better Email Tracking options to connect your tracker.",
						);
						return;
					}
					const file = await pickFile();
					if (!file) return;
					if (file.size > DEFAULT_MAX_DOCUMENT_BYTES) {
						ctx.adapter.showNotice(
							`“${file.name}” is ${formatBytes(file.size)}. Tracked documents can be up to ${formatBytes(DEFAULT_MAX_DOCUMENT_BYTES)}.`,
							"error",
						);
						return;
					}
					busy = true;
					control.update(BUSY);
					ctx.adapter.showNotice(
						`Uploading “${file.name}” (${formatBytes(file.size)})…`,
					);
					try {
						const doc = await upload(file);
						insertLink(session, documentLinkHtml(doc));
						ctx.adapter.showNotice(
							`Added tracked document “${doc.name}”. Each recipient gets their own link when this email is sent with tracking on.`,
						);
					} catch (err) {
						ctx.adapter.showNotice(
							`Couldn't upload “${file.name}”: ${errorMessage(err)}`,
							"error",
						);
					} finally {
						busy = false;
						control.update(hinted ? HINTED : IDLE);
					}
				},
			});

			const timer = setInterval(() => {
				const tracking =
					trackingAvailable(ctx) &&
					getMode(session, ctx.settings().defaultMode) !== "off";
				if (
					!shouldHintAttachments({
						tracking,
						hasAttachments: session.hasAttachments(),
						alreadyHinted: hinted,
					})
				)
					return;
				hinted = true;
				ctx.adapter.showNotice(ATTACHMENT_HINT);
				if (!busy) control.update(HINTED);
			}, HINT_POLL_MS);
			session.onDestroy(() => clearInterval(timer));
		});
	},
};
