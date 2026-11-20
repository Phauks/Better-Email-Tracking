import type { ComposeSession } from "../providers/types";
import type { DefaultMode } from "../settings";

/** Per-compose tracking choice, shared between compose features. */
export type ComposeMode = DefaultMode;

const modes = new WeakMap<ComposeSession, ComposeMode>();

export function getMode(
	session: ComposeSession,
	fallback: ComposeMode,
): ComposeMode {
	return modes.get(session) ?? fallback;
}

export function setMode(session: ComposeSession, mode: ComposeMode): void {
	modes.set(session, mode);
}

const ORDER: ComposeMode[] = ["shared", "individual", "off"];

export function nextMode(mode: ComposeMode): ComposeMode {
	return ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length] ?? "shared";
}
