<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import type { ViewController, ControllerState } from "../view/ViewController";
	import type { LayerInfo } from "../core/model/types";

	export let controller: ViewController;
	export let nudgeStep = 1;

	let state: ControllerState = controller.getState();
	let unsub: (() => void) | null = null;
	let layers: LayerInfo[] = controller.layers;

	onMount(() => {
		unsub = controller.events.on("state", (s) => {
			state = s;
			layers = controller.layers;
		});
	});
	onDestroy(() => unsub?.());

	$: entity = state.selected;

	function onLayerChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value;
		controller.changeLayer(value);
	}

	function onColorChange(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		if (value === "BYLAYER") controller.changeColor(null);
		else controller.changeColor(parseInt(value, 10));
	}

	const nudge = (dx: number, dy: number) => controller.moveSelected(dx, dy);
</script>

<div class="dxf-panel">
	<div class="dxf-panel-title">Properties</div>
	{#if !entity}
		<div class="dxf-panel-empty">Click an entity to inspect it.</div>
	{:else}
		<div class="dxf-prop-grid">
			<span class="dxf-prop-key">Type</span>
			<span class="dxf-prop-val">{entity.type}</span>
			<span class="dxf-prop-key">Handle</span>
			<span class="dxf-prop-val">{entity.id || "—"}</span>
			<span class="dxf-prop-key">Layer</span>
			<span class="dxf-prop-val">
				{#if state.editable}
					<select class="dropdown" value={entity.layer} on:change={onLayerChange}>
						{#each layers as l}
							<option value={l.name}>{l.name}</option>
						{/each}
						{#if !layers.find((l) => l.name === entity.layer)}
							<option value={entity.layer}>{entity.layer}</option>
						{/if}
					</select>
				{:else}
					{entity.layer}
				{/if}
			</span>
			<span class="dxf-prop-key">Color</span>
			<span class="dxf-prop-val">
				{#if state.editable}
					<select
						class="dropdown"
						value={entity.colorNumber !== undefined ? String(entity.colorNumber) : "BYLAYER"}
						on:change={onColorChange}
					>
						<option value="BYLAYER">ByLayer</option>
						<option value="1">1 · Red</option>
						<option value="2">2 · Yellow</option>
						<option value="3">3 · Green</option>
						<option value="4">4 · Cyan</option>
						<option value="5">5 · Blue</option>
						<option value="6">6 · Magenta</option>
						<option value="7">7 · White/Black</option>
						{#if entity.colorNumber !== undefined && entity.colorNumber > 7}
							<option value={String(entity.colorNumber)}>{entity.colorNumber}</option>
						{/if}
					</select>
				{:else}
					{entity.colorNumber !== undefined ? entity.colorNumber : "ByLayer"}
				{/if}
			</span>
			{#if entity.type === "TEXT" || entity.type === "MTEXT"}
				<span class="dxf-prop-key">Text</span>
				<span class="dxf-prop-val dxf-prop-text">{entity.text}</span>
			{/if}
			{#if entity.type === "UNSUPPORTED"}
				<span class="dxf-prop-key">DXF type</span>
				<span class="dxf-prop-val">{entity.dxfType}</span>
			{/if}
		</div>

		{#if state.editable}
			<div class="dxf-panel-subtitle">Move ({nudgeStep} units)</div>
			<div class="dxf-nudge">
				<div />
				<button class="dxf-tb-btn" on:click={() => nudge(0, nudgeStep)} title="Up">↑</button>
				<div />
				<button class="dxf-tb-btn" on:click={() => nudge(-nudgeStep, 0)} title="Left">←</button>
				<button class="dxf-tb-btn" on:click={() => controller.deleteSelected()} title="Delete">✕</button>
				<button class="dxf-tb-btn" on:click={() => nudge(nudgeStep, 0)} title="Right">→</button>
				<div />
				<button class="dxf-tb-btn" on:click={() => nudge(0, -nudgeStep)} title="Down">↓</button>
				<div />
			</div>
		{:else}
			<div class="dxf-panel-note">
				This entity type is view-only in v1{#if entity.type !== "UNSUPPORTED" && !entity.id}
					&nbsp;(no handle to address it safely){/if}.
			</div>
		{/if}
	{/if}
</div>
