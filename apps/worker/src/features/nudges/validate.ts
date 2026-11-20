import {
	isValidId,
	NUDGE_LIMITS,
	type NudgeAction,
	type NudgeStep,
	type Recipient,
	type SendWindow,
	stepsFromPolicy,
} from "@bet/shared";
import { fail, isNum, isObject, type Parsed } from "../../lib/parse";
import { isValidTimeZone } from "./schedule";

export function parseSteps(raw: unknown): Parsed<NudgeStep[]> {
	if (!Array.isArray(raw) || raw.length === 0) return fail("steps required");
	if (raw.length > NUDGE_LIMITS.maxSteps)
		return fail(`at most ${NUDGE_LIMITS.maxSteps} steps`);
	const steps: NudgeStep[] = [];
	for (const s of raw) {
		if (!isObject(s)) return fail("invalid step");
		if (!isNum(s.afterDays, 0, NUDGE_LIMITS.maxAfterDays))
			return fail("afterDays must be 0-90");
		if (typeof s.html !== "string" || !s.html.trim())
			return fail("step html required");
		if (s.html.length > NUDGE_LIMITS.maxHtml) return fail("step html too long");
		steps.push({ afterDays: s.afterDays, html: s.html });
	}
	return { ok: true, value: steps };
}

export function parseSendWindow(raw: unknown): Parsed<SendWindow | undefined> {
	if (raw === undefined || raw === null) return { ok: true, value: undefined };
	if (!isObject(raw)) return fail("invalid sendWindow");
	const { startHour, endHour, timeZone, weekdaysOnly } = raw;
	if (!isNum(startHour, 0, 23) || !isNum(endHour, 1, 24))
		return fail("sendWindow hours must be 0-24");
	if (!Number.isInteger(startHour) || !Number.isInteger(endHour))
		return fail("sendWindow hours must be whole");
	if (startHour >= endHour) return fail("sendWindow start must be before end");
	const win: SendWindow = { startHour, endHour };
	if (timeZone !== undefined) {
		if (typeof timeZone !== "string" || !isValidTimeZone(timeZone))
			return fail("invalid timeZone");
		win.timeZone = timeZone;
	}
	if (weekdaysOnly === true) win.weekdaysOnly = true;
	return { ok: true, value: win };
}

function parseAddressList(raw: unknown): Parsed<Recipient[] | undefined> {
	if (raw === undefined || raw === null) return { ok: true, value: undefined };
	if (!Array.isArray(raw) || raw.length > 100)
		return fail("invalid recipients");
	const out: Recipient[] = [];
	for (const r of raw) {
		if (!isObject(r) || typeof r.email !== "string" || !r.email.includes("@"))
			return fail("invalid recipient");
		out.push(
			typeof r.name === "string" && r.name
				? { email: r.email, name: r.name }
				: { email: r.email },
		);
	}
	return { ok: true, value: out };
}

export interface CreateNudgeInput {
	messageId: string;
	steps: NudgeStep[];
	stopOnOpen: boolean;
	sendWindow?: SendWindow;
	providerThreadId?: string;
	sentAt?: number;
	to?: Recipient[];
	cc?: Recipient[];
	replace: boolean;
}

/** Accepts explicit steps, or {intervalDays, maxNudges, template[, firstAfterDays]}. */
export function parseCreateNudge(body: unknown): Parsed<CreateNudgeInput> {
	if (!isObject(body)) return fail("body must be an object");
	const { messageId } = body;
	if (typeof messageId !== "string" || !isValidId(messageId))
		return fail("invalid messageId");
	let steps: NudgeStep[];
	if (body.steps !== undefined) {
		const parsed = parseSteps(body.steps);
		if (!parsed.ok) return parsed;
		steps = parsed.value;
	} else {
		const { intervalDays, maxNudges, template } = body;
		const firstAfterDays = body.firstAfterDays ?? intervalDays;
		if (!isNum(intervalDays, 0, NUDGE_LIMITS.maxAfterDays))
			return fail("intervalDays must be 0-90");
		if (!isNum(firstAfterDays, 0, NUDGE_LIMITS.maxAfterDays))
			return fail("firstAfterDays must be 0-90");
		if (!isNum(maxNudges, 1, NUDGE_LIMITS.maxSteps))
			return fail(`maxNudges must be 1-${NUDGE_LIMITS.maxSteps}`);
		if (typeof template !== "string") return fail("template required");
		const parsed = parseSteps(
			stepsFromPolicy(
				{ firstAfterDays, intervalDays, maxNudges: Math.floor(maxNudges) },
				template,
			),
		);
		if (!parsed.ok) return parsed;
		steps = parsed.value;
	}
	const win = parseSendWindow(body.sendWindow);
	if (!win.ok) return win;
	const to = parseAddressList(body.to);
	if (!to.ok) return to;
	const cc = parseAddressList(body.cc);
	if (!cc.ok) return cc;
	const value: CreateNudgeInput = {
		messageId,
		steps,
		stopOnOpen: body.stopOnOpen === true,
		replace: body.replace === true,
	};
	if (win.value) value.sendWindow = win.value;
	if (to.value?.length) value.to = to.value;
	if (cc.value?.length) value.cc = cc.value;
	if (
		typeof body.providerThreadId === "string" &&
		body.providerThreadId.trim() &&
		body.providerThreadId.length <= 256
	)
		value.providerThreadId = body.providerThreadId.trim();
	if (isNum(body.sentAt, 1, Number.MAX_SAFE_INTEGER))
		value.sentAt = body.sentAt;
	return { ok: true, value };
}

export interface UpdateNudgeInput {
	action?: NudgeAction;
	steps?: NudgeStep[];
	stopOnOpen?: boolean;
	sendWindow?: SendWindow | null;
}

export function parseUpdateNudge(body: unknown): Parsed<UpdateNudgeInput> {
	if (!isObject(body)) return fail("body must be an object");
	const value: UpdateNudgeInput = {};
	if (body.action !== undefined) {
		if (body.action !== "pause" && body.action !== "resume")
			return fail("action must be pause or resume");
		value.action = body.action;
	}
	if (body.steps !== undefined) {
		const steps = parseSteps(body.steps);
		if (!steps.ok) return steps;
		value.steps = steps.value;
	}
	if (body.stopOnOpen !== undefined) {
		if (typeof body.stopOnOpen !== "boolean")
			return fail("stopOnOpen must be boolean");
		value.stopOnOpen = body.stopOnOpen;
	}
	if (body.sendWindow !== undefined) {
		if (body.sendWindow === null) value.sendWindow = null;
		else {
			const win = parseSendWindow(body.sendWindow);
			if (!win.ok) return win;
			if (win.value) value.sendWindow = win.value;
		}
	}
	return { ok: true, value };
}
