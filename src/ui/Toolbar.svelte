<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import type { ViewController, ControllerState } from "../view/ViewController";

	export let controller: ViewController;
	export let onSave: () => void;

	let state: ControllerState = controller.getState();
	let unsub: (() => void) | null = null;

	onMount(() => {
		unsub = controller.events.on("state", (s) => (state = s));
	});
	onDestroy(() => unsub?.());
</script>

<div class="dxf-toolbar">
	<button class="dxf-tb-btn" title="Fit to view" on:click={() => controller.fit()}>Fit</button>
	<div class="dxf-tb-sep" />
	<button
		class="dxf-tb-btn"
		title="Undo"
		disabled={!state.canUndo}
		on:click={() => controller.undo()}>Undo</button
	>
	<button
		class="dxf-tb-btn"
		title="Redo"
		disabled={!state.canRedo}
		on:click={() => controller.redo()}>Redo</button
	>
	<div class="dxf-tb-sep" />
	<button
		class="dxf-tb-btn"
		title="Delete selected entity"
		disabled={!state.editable}
		on:click={() => controller.deleteSelected()}>Delete</button
	>
	<div class="dxf-tb-spacer" />
	{#if state.dirty}
		<span class="dxf-dirty" title="Unsaved changes">● unsaved</span>
	{/if}
	<button class="dxf-tb-btn mod-cta" title="Save to file (Ctrl/Cmd+S)" on:click={onSave}>Save</button>
</div>
