<script lang="ts">
	import type { ViewController } from "../view/ViewController";
	import type { LayerInfo } from "../core/model/types";

	export let controller: ViewController;

	const layers: LayerInfo[] = controller.layers;

	function swatch(color: number): string {
		return "#" + (color & 0xffffff).toString(16).padStart(6, "0");
	}
</script>

<div class="dxf-panel">
	<div class="dxf-panel-title">Layers</div>
	{#if layers.length === 0}
		<div class="dxf-panel-empty">No layer table in this file.</div>
	{:else}
		<ul class="dxf-layer-list">
			{#each layers as l}
				<li class="dxf-layer-row">
					<span class="dxf-layer-swatch" style="background:{swatch(l.color)}" />
					<span class="dxf-layer-name">{l.name}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
