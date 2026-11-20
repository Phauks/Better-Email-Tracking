/**
 * Single icon registry: Phosphor SVGs imported as raw strings. Used by Icon.svelte in
 * extension pages and (as data: URLs) by content-script badges and compose buttons.
 */

import check from "@phosphor-icons/core/assets/bold/check-bold.svg?raw";
import checks from "@phosphor-icons/core/assets/bold/checks-bold.svg?raw";
import cursorClick from "@phosphor-icons/core/assets/bold/cursor-click-bold.svg?raw";
import alarmFill from "@phosphor-icons/core/assets/fill/alarm-fill.svg?raw";
import alarm from "@phosphor-icons/core/assets/regular/alarm.svg?raw";
import arrowBendUpRight from "@phosphor-icons/core/assets/regular/arrow-bend-up-right.svg?raw";
import arrowClockwise from "@phosphor-icons/core/assets/regular/arrow-clockwise.svg?raw";
import arrowSquareOut from "@phosphor-icons/core/assets/regular/arrow-square-out.svg?raw";
import arrowUUpLeft from "@phosphor-icons/core/assets/regular/arrow-u-up-left.svg?raw";
import bell from "@phosphor-icons/core/assets/regular/bell.svg?raw";
import caretDown from "@phosphor-icons/core/assets/regular/caret-down.svg?raw";
import caretRight from "@phosphor-icons/core/assets/regular/caret-right.svg?raw";
import chatCircleText from "@phosphor-icons/core/assets/regular/chat-circle-text.svg?raw";
import checkCircle from "@phosphor-icons/core/assets/regular/check-circle.svg?raw";
import clock from "@phosphor-icons/core/assets/regular/clock.svg?raw";
import desktop from "@phosphor-icons/core/assets/regular/desktop.svg?raw";
import deviceMobile from "@phosphor-icons/core/assets/regular/device-mobile.svg?raw";
import downloadSimple from "@phosphor-icons/core/assets/regular/download-simple.svg?raw";
import envelopeSimpleOpen from "@phosphor-icons/core/assets/regular/envelope-simple-open.svg?raw";
import eye from "@phosphor-icons/core/assets/regular/eye.svg?raw";
import eyeSlash from "@phosphor-icons/core/assets/regular/eye-slash.svg?raw";
import fileArrowUp from "@phosphor-icons/core/assets/regular/file-arrow-up.svg?raw";
import fileCsv from "@phosphor-icons/core/assets/regular/file-csv.svg?raw";
import filePdf from "@phosphor-icons/core/assets/regular/file-pdf.svg?raw";
import fileText from "@phosphor-icons/core/assets/regular/file-text.svg?raw";
import gear from "@phosphor-icons/core/assets/regular/gear.svg?raw";
import globe from "@phosphor-icons/core/assets/regular/globe.svg?raw";
import magnifyingGlass from "@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw";
import paperPlaneTilt from "@phosphor-icons/core/assets/regular/paper-plane-tilt.svg?raw";
import pause from "@phosphor-icons/core/assets/regular/pause.svg?raw";
import play from "@phosphor-icons/core/assets/regular/play.svg?raw";
import plugsConnected from "@phosphor-icons/core/assets/regular/plugs-connected.svg?raw";
import plus from "@phosphor-icons/core/assets/regular/plus.svg?raw";
import prohibit from "@phosphor-icons/core/assets/regular/prohibit.svg?raw";
import robot from "@phosphor-icons/core/assets/regular/robot.svg?raw";
import shieldCheck from "@phosphor-icons/core/assets/regular/shield-check.svg?raw";
import trash from "@phosphor-icons/core/assets/regular/trash.svg?raw";
import uploadSimple from "@phosphor-icons/core/assets/regular/upload-simple.svg?raw";
import users from "@phosphor-icons/core/assets/regular/users.svg?raw";
import warning from "@phosphor-icons/core/assets/regular/warning.svg?raw";
import warningCircle from "@phosphor-icons/core/assets/regular/warning-circle.svg?raw";
import x from "@phosphor-icons/core/assets/regular/x.svg?raw";
import xCircle from "@phosphor-icons/core/assets/regular/x-circle.svg?raw";

export const ICONS = {
	alarm,
	"alarm-fill": alarmFill,
	"arrow-bend-up-right": arrowBendUpRight,
	"arrow-clockwise": arrowClockwise,
	"arrow-square-out": arrowSquareOut,
	"arrow-u-up-left": arrowUUpLeft,
	bell,
	"caret-down": caretDown,
	"caret-right": caretRight,
	"chat-circle-text": chatCircleText,
	check,
	"check-circle": checkCircle,
	checks,
	clock,
	"cursor-click": cursorClick,
	desktop,
	"device-mobile": deviceMobile,
	"download-simple": downloadSimple,
	"envelope-simple-open": envelopeSimpleOpen,
	eye,
	"eye-slash": eyeSlash,
	"file-arrow-up": fileArrowUp,
	"file-csv": fileCsv,
	"file-pdf": filePdf,
	"file-text": fileText,
	gear,
	globe,
	"magnifying-glass": magnifyingGlass,
	"paper-plane-tilt": paperPlaneTilt,
	pause,
	play,
	"plugs-connected": plugsConnected,
	plus,
	prohibit,
	robot,
	"shield-check": shieldCheck,
	trash,
	"upload-simple": uploadSimple,
	users,
	warning,
	"warning-circle": warningCircle,
	x,
	"x-circle": xCircle,
} as const;

export type IconName = keyof typeof ICONS;

/** SVG markup with the fill color baked in (for contexts without CSS currentColor). */
export function coloredSvg(svg: string, color: string): string {
	return svg.replace(/currentColor/g, color);
}

export function svgDataUrl(svg: string, color: string): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(coloredSvg(svg, color))}`;
}
