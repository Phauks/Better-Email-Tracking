import { type Component, mount } from "svelte";
import "./theme.css";

export function mountPage(component: Component): void {
	const target = document.getElementById("app");
	if (!target) throw new Error("#app missing");
	mount(component, { target });
}
