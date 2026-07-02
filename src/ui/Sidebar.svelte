<script lang="ts">
	import type { ViewController } from "../view/ViewController";
	import PropertyPanel from "./PropertyPanel.svelte";
	import LayerPanel from "./LayerPanel.svelte";

	export let controller: ViewController;
	export let nudgeStep = 1;
</script>

<div class="dxf-sidebar">
	<PropertyPanel {controller} {nudgeStep} />
	<LayerPanel {controller} />
</div>
