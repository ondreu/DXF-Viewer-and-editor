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
			{ id: "draw-circle", name: "circle", label: "Draw circle (centre + radius)" },
			{ id: "draw-circle-2p", name: "disc", label: "Draw circle (2-point / diameter)" },
			{ id: "draw-circle-3p", name: "atom", label: "Draw circle (3-point)" },
			{ id: "draw-arc", name: "spline-pointer", label: "Draw arc (centre + start + end)" },
			{ id: "draw-arc-3p", name: "waypoints", label: "Draw arc (3-point)" },
			{ id: "draw-polyline", name: "spline", label: "Draw polyline" },
			{ id: "draw-rectangle", name: "rectangle-horizontal", label: "Draw rectangle" },
			{ id: "draw-polygon", name: "hexagon", label: "Draw regular polygon" },
			{ id: "draw-text", name: "type", label: "Add text" },
		],
		[
			{ id: "copy", name: "copy", label: "Copy selection" },
			{ id: "rotate", name: "rotate-cw", label: "Rotate selection" },
			{ id: "scale", name: "maximize-2", label: "Scale selection" },
			{ id: "mirror", name: "flip-horizontal", label: "Mirror selection" },
		],
		[
			{ id: "fillet", name: "corner-down-right", label: "Fillet (round a corner)" },
			{ id: "chamfer", name: "corner-up-right", label: "Chamfer (bevel a corner)" },
			{ id: "trim", name: "scissors", label: "Trim to a cutting edge" },
			{ id: "extend", name: "move-diagonal", label: "Extend to a boundary" },
			{ id: "offset", name: "separator-horizontal", label: "Offset (parallel copy)" },
		],
		[
			{ id: "array-rect", name: "grid-3x3", label: "Rectangular array" },
			{ id: "array-polar", name: "orbit", label: "Polar array" },
			{ id: "match-props", name: "pipette", label: "Match properties" },
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
