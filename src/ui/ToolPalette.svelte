<script lang="ts">
	import { icon } from "./actions";
	import type { ViewController, ControllerState } from "../view/ViewController";
	import type { ToolId } from "../interaction/types";

	export let controller: ViewController;
	export let state: ControllerState;

	interface Item { id: ToolId; name: string; label: string; }
	const groups: Item[][] = [
		[{ id: "select", name: "mouse-pointer", label: "Select" }],
		[
			{ id: "measure-distance", name: "ruler", label: "Measure distance" },
			{ id: "measure-radius", name: "circle-dot", label: "Measure radius / diameter" },
			{ id: "measure-angle", name: "triangle", label: "Measure angle" },
		],
		[
			{ id: "draw-line", name: "pencil", label: "Draw line" },
			{ id: "draw-circle", name: "circle", label: "Draw circle" },
			{ id: "draw-polyline", name: "spline", label: "Draw polyline" },
			{ id: "draw-text", name: "type", label: "Add text" },
		],
		[{ id: "annotate", name: "sticky-note", label: "Add note (annotation)" }],
	];
</script>

<div class="dxf-palette">
	{#each groups as group, gi}
		{#if gi > 0}<div class="dxf-palette-sep" />{/if}
		{#each group as item}
			<button
				class="dxf-tool-btn"
				class:is-active={state.activeTool === item.id}
				title={item.label}
				aria-label={item.label}
				on:click={() => controller.setTool(item.id)}
				use:icon={item.name}
			/>
		{/each}
	{/each}
</div>
