<script lang="ts">
	import Card from "./Card.svelte";
	import { icon } from "./actions";
	import { entityLength } from "../core/geom/geometry2d";
	import type { ViewController, ControllerState } from "../view/ViewController";

	export let controller: ViewController;
	export let state: ControllerState;

	$: entity = state.selected;
	$: layers = state.layers;
	$: multi = state.selectionCount > 1;
	$: anchor = entity ? controller.dxfDocument?.anchorOf(entity.id) ?? null : null;

	const num = (e: Event) => parseFloat((e.target as HTMLInputElement).value);

	function onLayer(e: Event) {
		controller.changeLayer((e.target as HTMLSelectElement).value);
	}
	function onColor(e: Event) {
		const v = (e.target as HTMLSelectElement).value;
		controller.changeColor(v === "BYLAYER" ? null : parseInt(v, 10));
	}
	function setAnchor(axis: "x" | "y", e: Event) {
		if (!anchor) return;
		const v = num(e);
		if (Number.isNaN(v)) return;
		controller.setSelectedAnchor(axis === "x" ? v : anchor.x, axis === "y" ? v : anchor.y);
	}
	function setProp(patch: Parameters<ViewController["setSelectedProps"]>[0], e: Event) {
		const v = num(e);
		if (Number.isNaN(v)) return;
		const key = Object.keys(patch)[0] as keyof typeof patch;
		controller.setSelectedProps({ [key]: v } as typeof patch);
	}
	function setText(e: Event) {
		controller.setSelectedProps({ text: (e.target as HTMLInputElement).value });
	}
</script>

{#if entity}
	<Card title={multi ? `${state.selectionCount} selected` : "Properties"} anchor="anchor-tr" onClose={() => controller.clearSelection()}>
		{#if multi}
			<div class="dxf-note" style="margin-top:0">Editing applies to all {state.selectionCount} selected entities.</div>
		{/if}
		{#if multi && state.selectionLength > 0}
			<div class="dxf-kv" style="margin-bottom:6px">
				<span class="dxf-k">Total length</span><span class="dxf-v dxf-mono">{state.selectionLength.toFixed(4)}</span>
			</div>
		{/if}
		<div class="dxf-kv">
			<span class="dxf-k">Type</span><span class="dxf-v">{entity.type}</span>
			{#if !multi}<span class="dxf-k">Handle</span><span class="dxf-v">{entity.id || "—"}</span>{/if}
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

			{#if state.editable && !multi}
				{#if anchor}
					<span class="dxf-k">X</span>
					<span class="dxf-v"><input class="dxf-num" type="number" step="any" value={anchor.x} on:change={(e) => setAnchor("x", e)} /></span>
					<span class="dxf-k">Y</span>
					<span class="dxf-v"><input class="dxf-num" type="number" step="any" value={anchor.y} on:change={(e) => setAnchor("y", e)} /></span>
				{/if}
				{#if entity.type === "LINE" || entity.type === "ARC" || entity.type === "CIRCLE" || entity.type === "LWPOLYLINE"}
					<span class="dxf-k">Length</span><span class="dxf-v dxf-mono">{entityLength(entity).toFixed(4)}</span>
				{/if}
				{#if entity.type === "CIRCLE" || entity.type === "ARC"}
					<span class="dxf-k">Radius</span>
					<span class="dxf-v"><input class="dxf-num" type="number" step="any" min="0" value={entity.radius} on:change={(e) => setProp({ radius: 0 }, e)} /></span>
				{/if}
				{#if entity.type === "ARC"}
					<span class="dxf-k">Start°</span>
					<span class="dxf-v"><input class="dxf-num" type="number" step="any" value={entity.startAngle} on:change={(e) => setProp({ startAngle: 0 }, e)} /></span>
					<span class="dxf-k">End°</span>
					<span class="dxf-v"><input class="dxf-num" type="number" step="any" value={entity.endAngle} on:change={(e) => setProp({ endAngle: 0 }, e)} /></span>
				{/if}
				{#if entity.type === "TEXT" || entity.type === "MTEXT"}
					<span class="dxf-k">Height</span>
					<span class="dxf-v"><input class="dxf-num" type="number" step="any" min="0" value={entity.height} on:change={(e) => setProp({ height: 0 }, e)} /></span>
					<span class="dxf-k">Rotation°</span>
					<span class="dxf-v"><input class="dxf-num" type="number" step="any" value={entity.rotation} on:change={(e) => setProp({ rotation: 0 }, e)} /></span>
					<span class="dxf-k">Text</span>
					<span class="dxf-v"><input class="dxf-num" type="text" value={entity.text} on:change={setText} /></span>
				{/if}
			{:else if entity.type === "TEXT" || entity.type === "MTEXT"}
				<span class="dxf-k">Text</span><span class="dxf-v dxf-mono">{entity.text}</span>
			{/if}
			{#if entity.type === "UNSUPPORTED"}
				<span class="dxf-k">DXF type</span><span class="dxf-v">{entity.dxfType}</span>
			{/if}
		</div>

		{#if state.editable}
			<div class="dxf-actions">
				<div class="dxf-rot-group">
					<button class="dxf-icon-btn" title="Rotate 90° CCW" on:click={() => controller.rotateSelected(90)} use:icon={"rotate-ccw"} />
					<button class="dxf-icon-btn" title="Rotate 90° CW" on:click={() => controller.rotateSelected(-90)} use:icon={"rotate-cw"} />
				</div>
				<button class="dxf-icon-btn danger" title="Delete (Del)" on:click={() => controller.deleteSelected()} use:icon={"trash-2"} />
			</div>
			<div class="dxf-note">Drag grips/body to move · Rotate tool for free angle.</div>
		{:else}
			<div class="dxf-note">This entity type is view-only.</div>
		{/if}
	</Card>
{/if}
