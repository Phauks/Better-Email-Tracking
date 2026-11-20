import type { UploadDocumentResponse } from "@bet/shared";

/** Background messages used by tracked documents (merged into BgRequest in messaging.ts). */
export type DocumentBgRequest =
	/** File bytes as base64: runtime messages are JSON, so ArrayBuffers can't cross. */
	{ type: "bet:docUpload"; name: string; mime: string; dataBase64: string };

export interface DocumentBgResponseMap {
	"bet:docUpload": UploadDocumentResponse;
}
