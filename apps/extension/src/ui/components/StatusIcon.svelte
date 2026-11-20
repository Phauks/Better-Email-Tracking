<script lang="ts">
	import type { ThreadStatusKind } from "@bet/shared";
	import { STATUS_STYLE } from "../../lib/status-badge";
	import Icon from "./Icon.svelte";

	let { status, size = 16 }: { status: ThreadStatusKind; size?: number } = $props();
	const style = $derived(STATUS_STYLE[status]);
</script>

<span class="status-{status}"><Icon name={style.icon} {size} label={style.label} /></span>
