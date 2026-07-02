<script lang="ts">
	import Card from "./Card.svelte";
	import { icon } from "./actions";
	import type { ViewController, ControllerState } from "../view/ViewController";

	export let controller: ViewController;
	export let state: ControllerState;
	export let nudgeStep = 1;

	$: entity = state.selected;
	$: layers = state.layers;

	const nudge = (dx: number, dy: number) => controller.moveSelected(dx, dy);

	function onLayer(e: Event) {
		controller.changeLayer((e.target as HTMLSelectElement).value);
	}
	function onColor(e: Event) {
		const v = (e.target as HTMLSelectElement).value;
		controller.changeColor(v === "BYLAYER" ? null : parseInt(v, 10));
	}
</script>

{#if entity}
	<Card title="Properties" anchor="anchor-tr" onClose={() => controller.renderer.select(null)}>
		<div class="dxf-kv">
			<span class="dxf-k">Type</span><span class="dxf-v">{entity.type}</span>
			<span class="dxf-k">Handle</span><span class="dxf-v">{entity.id || "—"}</span>
			<span class="dxf-k">Layer</span>
			<span class="dxf-v">
				{#if state.editable}
					<select class="dropdown" value={entity.layer} on:change={onLayer}>
						{#each layers as l}<option value={l.name}>{l.name}</option>{/each}
						{#if !layers.find((l) => l.name === entity.layer)}
							<option value={entity.layer}>{entity.layer}</option>
						{/if}
					</select>
				{:else}{entity.layer}{/if}
			</span>
			<span class="dxf-k">Colour</span>
			<span class="dxf-v">
				{#if state.editable}
					<select class="dropdown" value={entity.colorNumber !== undefined ? String(entity.colorNumber) : "BYLAYER"} on:change={onColor}>
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
				{:else}{entity.colorNumber ?? "ByLayer"}{/if}
			</span>
			{#if entity.type === "TEXT" || entity.type === "MTEXT"}
				<span class="dxf-k">Text</span><span class="dxf-v dxf-mono">{entity.text}</span>
			{/if}
			{#if entity.type === "UNSUPPORTED"}
				<span class="dxf-k">DXF type</span><span class="dxf-v">{entity.dxfType}</span>
			{/if}
		</div>

		{#if state.editable}
			<div class="dxf-nudge">
				<span />
				<button class="dxf-icon-btn" title="Move up" on:click={() => nudge(0, nudgeStep)} use:icon={"arrow-up"} />
				<span />
				<button class="dxf-icon-btn" title="Move left" on:click={() => nudge(-nudgeStep, 0)} use:icon={"arrow-left"} />
				<button class="dxf-icon-btn danger" title="Delete" on:click={() => controller.deleteSelected()} use:icon={"trash-2"} />
				<button class="dxf-icon-btn" title="Move right" on:click={() => nudge(nudgeStep, 0)} use:icon={"arrow-right"} />
				<span />
				<button class="dxf-icon-btn" title="Move down" on:click={() => nudge(0, -nudgeStep)} use:icon={"arrow-down"} />
				<span />
			</div>
		{:else}
			<div class="dxf-note">View-only in v1.</div>
		{/if}
	</Card>
{/if}
