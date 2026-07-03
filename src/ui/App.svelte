<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { icon } from "./actions";
	import Ribbon from "./Ribbon.svelte";
	import PropertiesCard from "./PropertiesCard.svelte";
	import MeasureCard from "./MeasureCard.svelte";
	import LayersCard from "./LayersCard.svelte";
	import AnnotationsCard from "./AnnotationsCard.svelte";
	import type { ViewController, ControllerState } from "../view/ViewController";

	export let controller: ViewController;
	export let onSave: () => void;
	export let onScreenshot: () => void;

	let state: ControllerState = controller.getState();
	let unsub: (() => void) | null = null;
	let showLayers = false;
	let showAnnotations = false;

	onMount(() => {
		unsub = controller.events.on("state", (s) => (state = s));
	});
	onDestroy(() => unsub?.());
</script>

<div class="dxf-ui">
	<div class="dxf-ui-topbar">
		<Ribbon {controller} {state} />

		<div class="dxf-ui-top">
			<button class="dxf-icon-btn" title="Fit to view" on:click={() => controller.fit()} use:icon={"maximize"} />
			<button class="dxf-icon-btn" class:is-active={state.gridVisible} title="Toggle grid" on:click={() => controller.toggleGrid()} use:icon={"grid"} />
			<button class="dxf-icon-btn" class:is-active={state.snap.enabled} title="Toggle snapping" on:click={() => controller.setSnap({ enabled: !state.snap.enabled })} use:icon={"magnet"} />
			<button class="dxf-icon-btn" class:is-active={state.snap.ortho} title="Ortho: lock new lines to 0/90/180/270°" on:click={() => controller.setSnap({ ortho: !state.snap.ortho })} use:icon={"axis-3d"} />
			<button class="dxf-icon-btn" title="Screenshot (PNG to vault)" on:click={onScreenshot} use:icon={"camera"} />
			<span class="dxf-top-sep" />
			<button class="dxf-icon-btn" title="Undo" disabled={!state.canUndo} on:click={() => controller.undo()} use:icon={"undo-2"} />
			<button class="dxf-icon-btn" title="Redo" disabled={!state.canRedo} on:click={() => controller.redo()} use:icon={"redo-2"} />
			<button class="dxf-icon-btn" title="Delete selection (Del)" disabled={state.selectionCount === 0} on:click={() => controller.deleteSelected()} use:icon={"trash-2"} />
			<span class="dxf-top-sep" />
			<button
				class="dxf-icon-btn"
				class:is-active={state.isolating}
				title={state.isolating ? "Show all layers" : "Isolate selected entities' layer(s)"}
				disabled={!state.isolating && state.selectionCount === 0}
				on:click={() => controller.toggleIsolate()}
				use:icon={"eye"}
			/>
			<span class="dxf-top-sep" />
			<button class="dxf-icon-btn" class:is-active={showLayers} title="Layers & draw settings" on:click={() => (showLayers = !showLayers)} use:icon={"layers"} />
			<button class="dxf-icon-btn" class:is-active={showAnnotations} title="Annotations" on:click={() => (showAnnotations = !showAnnotations)} use:icon={"sticky-note"} />
			<span class="dxf-top-sep" />
			<button class="dxf-icon-btn cta" title="Save (Ctrl/Cmd+S)" on:click={onSave} use:icon={"save"}>
				{#if state.dirty}<span class="dxf-dot" />{/if}
			</button>
		</div>
	</div>

	<div class="dxf-cards">
		<PropertiesCard {controller} {state} />
		<MeasureCard {controller} {state} />
		{#if showLayers}
			<LayersCard {controller} {state} onClose={() => (showLayers = false)} />
		{/if}
		{#if showAnnotations}
			<AnnotationsCard {controller} {state} onClose={() => (showAnnotations = false)} />
		{/if}
	</div>

	<div class="dxf-hint">{state.hint}</div>
</div>
