import type {
	ConnectorStatusResponse,
	CreateNudgeRequest,
	NudgeSequence,
} from "@bet/shared";

/** Background messages used by follow-up nudges (merged into BgRequest in messaging.ts). */
export type NudgeBgRequest =
	| { type: "bet:createNudge"; req: CreateNudgeRequest }
	| { type: "bet:connectorStatus" }
	| { type: "bet:openOptions" };

/** Expected refusals come back as data so the compose UI can explain them. */
export type CreateNudgeResult =
	| { ok: true; sequence: NudgeSequence }
	| { ok: false; code: "no_connector" | "no_thread" | "error"; error: string };

export interface NudgeBgResponseMap {
	"bet:createNudge": CreateNudgeResult;
	"bet:connectorStatus": ConnectorStatusResponse;
	"bet:openOptions": null;
}
