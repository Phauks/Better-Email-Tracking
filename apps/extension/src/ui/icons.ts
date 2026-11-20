/**
 * Single icon registry: Phosphor SVGs imported as raw strings. Used by Icon.svelte in
 * extension pages and (as data: URLs) by content-script badges and compose buttons.
 */

import check from "@phosphor-icons/core/assets/bold/check-bold.svg?raw";
import checks from "@phosphor-icons/core/assets/bold/checks-bold.svg?raw";
import cursorClick from "@phosphor-icons/core/assets/bold/cursor-click-bold.svg?raw";
import arrowClockwise from "@phosphor-icons/core/assets/regular/arrow-clockwise.svg?raw";
import arrowSquareOut from "@phosphor-icons/core/assets/regular/arrow-square-out.svg?raw";
import bell from "@phosphor-icons/core/assets/regular/bell.svg?raw";
import caretDown from "@phosphor-icons/core/assets/regular/caret-down.svg?raw";
import caretRight from "@phosphor-icons/core/assets/regular/caret-right.svg?raw";
import desktop from "@phosphor-icons/core/assets/regular/desktop.svg?raw";
import deviceMobile from "@phosphor-icons/core/assets/regular/device-mobile.svg?raw";
import envelopeSimpleOpen from "@phosphor-icons/core/assets/regular/envelope-simple-open.svg?raw";
import eye from "@phosphor-icons/core/assets/regular/eye.svg?raw";
import eyeSlash from "@phosphor-icons/core/assets/regular/eye-slash.svg?raw";
import gear from "@phosphor-icons/core/assets/regular/gear.svg?raw";
import globe from "@phosphor-icons/core/assets/regular/globe.svg?raw";
import magnifyingGlass from "@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw";
import plugsConnected from "@phosphor-icons/core/assets/regular/plugs-connected.svg?raw";
import robot from "@phosphor-icons/core/assets/regular/robot.svg?raw";
import shieldCheck from "@phosphor-icons/core/assets/regular/shield-check.svg?raw";
import users from "@phosphor-icons/core/assets/regular/users.svg?raw";
import warning from "@phosphor-icons/core/assets/regular/warning.svg?raw";
import x from "@phosphor-icons/core/assets/regular/x.svg?raw";

export const ICONS = {
	"arrow-clockwise": arrowClockwise,
	"arrow-square-out": arrowSquareOut,
	bell,
	"caret-down": caretDown,
	"caret-right": caretRight,
	check,
	checks,
	"cursor-click": cursorClick,
	desktop,
	"device-mobile": deviceMobile,
	"envelope-simple-open": envelopeSimpleOpen,
	eye,
	"eye-slash": eyeSlash,
	gear,
	globe,
	"magnifying-glass": magnifyingGlass,
	"plugs-connected": plugsConnected,
	robot,
	"shield-check": shieldCheck,
	users,
	warning,
	x,
} as const;

export type IconName = keyof typeof ICONS;

/** SVG markup with the fill color baked in (for contexts without CSS currentColor). */
export function coloredSvg(svg: string, color: string): string {
	return svg.replace(/currentColor/g, color);
}

export function svgDataUrl(svg: string, color: string): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(coloredSvg(svg, color))}`;
}
