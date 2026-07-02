<script lang="ts">
	import Card from "./Card.svelte";
	import type { ViewController, ControllerState } from "../view/ViewController";

	export let controller: ViewController;
	export let state: ControllerState;
	export let onClose: () => void;

	const swatch = (c: number) => "#" + (c & 0xffffff).toString(16).padStart(6, "0");

	function onActiveLayer(e: Event) {
		controller.setActiveLayer((e.target as HTMLSelectElement).value);
	}
	function onActiveColor(e: Event) {
		const v = (e.target as HTMLSelectElement).value;
		controller.setActiveColor(v === "BYLAYER" ? null : parseInt(v, 10));
	}
</script>

<Card title="Layers & draw settings" anchor="anchor-tl-2" {onClose}>
	<div class="dxf-kv">
		<span class="dxf-k">Draw on</span>
		<span class="dxf-v">
			<select class="dropdown" value={state.activeLayer} on:change={onActiveLayer}>
				{#if state.layers.length === 0}<option value="0">0</option>{/if}
				{#each state.layers as l}<option value={l.name}>{l.name}</option>{/each}
			</select>
		</span>
		<span class="dxf-k">Colour</span>
		<span class="dxf-v">
			<select class="dropdown" value={state.activeColor !== null ? String(state.activeColor) : "BYLAYER"} on:change={onActiveColor}>
				<option value="BYLAYER">ByLayer</option>
				<option value="1">1 · Red</option>
				<option value="2">2 · Yellow</option>
				<option value="3">3 · Green</option>
				<option value="4">4 · Cyan</option>
				<option value="5">5 · Blue</option>
				<option value="6">6 · Magenta</option>
				<option value="7">7 · White/Black</option>
			</select>
		</span>
	</div>

	{#if state.layers.length}
		<ul class="dxf-layer-list">
			{#each state.layers as l}
				<li class="dxf-layer-row">
					<span class="dxf-layer-swatch" style="background:{swatch(l.color)}" />
					<span class="dxf-layer-name">{l.name}</span>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="dxf-note">No layer table in this file.</div>
	{/if}
</Card>
