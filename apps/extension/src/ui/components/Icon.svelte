<script lang="ts">
	import { ICONS, type IconName } from "../icons";

	let {
		name,
		size = 16,
		label,
	}: { name: IconName; size?: number; label?: string } = $props();
</script>

<span
	class="icon"
	style:width="{size}px"
	style:height="{size}px"
	role={label ? "img" : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : "true"}
	title={label}
>
	<!-- Trusted: SVG strings bundled from @phosphor-icons/core -->
	{@html ICONS[name]}
</span>

<style>
	.icon {
		display: inline-flex;
		flex: none;
		vertical-align: middle;
	}
	.icon :global(svg) {
		width: 100%;
		height: 100%;
	}
</style>
