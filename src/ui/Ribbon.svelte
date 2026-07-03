<script lang="ts">
	import { icon } from "./actions";
	import type { ViewController, ControllerState } from "../view/ViewController";
	import type { ToolId } from "../interaction/types";

	export let controller: ViewController;
	export let state: ControllerState;

	interface Item {
		id: ToolId;
		name: string;
		label: string;
	}
	interface Group {
		id: string;
		label: string;
		items: Item[];
	}

	const groups: Group[] = [
		{
			id: "select",
			label: "Select",
			items: [
				{ id: "select", name: "mouse-pointer", label: "Select" },
				{ id: "select-similar", name: "list-filter", label: "Select similar (same type + layer)" },
			],
		},
		{
			id: "measure",
			label: "Measure",
			items: [
				{ id: "measure-distance", name: "ruler", label: "Measure distance" },
				{ id: "measure-radius", name: "circle-dot", label: "Measure radius / diameter" },
				{ id: "measure-angle", name: "triangle", label: "Measure angle" },
				{ id: "measure-area", name: "square", label: "Measure area / perimeter" },
				{ id: "measure-point", name: "crosshair", label: "Coordinate readout (ID point)" },
			],
		},
		{
			id: "draw",
			label: "Draw",
			items: [
				{ id: "draw-line", name: "pencil", label: "Draw line" },
				{ id: "draw-circle", name: "circle", label: "Draw circle (centre + radius)" },
				{ id: "draw-circle-2p", name: "disc", label: "Draw circle (2-point / diameter)" },
				{ id: "draw-circle-3p", name: "atom", label: "Draw circle (3-point)" },
				{ id: "draw-arc", name: "spline-pointer", label: "Draw arc (centre + start + end)" },
				{ id: "draw-arc-3p", name: "waypoints", label: "Draw arc (3-point)" },
				{ id: "draw-ellipse", name: "egg", label: "Draw ellipse" },
				{ id: "draw-polyline", name: "spline", label: "Draw polyline" },
				{ id: "draw-rectangle", name: "rectangle-horizontal", label: "Draw rectangle" },
				{ id: "draw-polygon", name: "hexagon", label: "Draw regular polygon" },
				{ id: "draw-text", name: "type", label: "Add text" },
			],
		},
		{
			id: "modify",
			label: "Modify",
			items: [
				{ id: "copy", name: "copy", label: "Copy selection" },
				{ id: "rotate", name: "rotate-cw", label: "Rotate selection" },
				{ id: "scale", name: "maximize-2", label: "Scale selection" },
				{ id: "mirror", name: "flip-horizontal", label: "Mirror selection" },
				{ id: "fillet", name: "corner-down-right", label: "Fillet (round a corner)" },
				{ id: "chamfer", name: "corner-up-right", label: "Chamfer (bevel a corner)" },
				{ id: "trim", name: "scissors", label: "Trim to a cutting edge" },
				{ id: "extend", name: "move-diagonal", label: "Extend to a boundary" },
				{ id: "offset", name: "separator-horizontal", label: "Offset (parallel copy)" },
				{ id: "join", name: "link", label: "Join connected LINEs into a polyline" },
				{ id: "break", name: "unlink", label: "Break a LINE/ARC at a point" },
				{ id: "explode", name: "split", label: "Explode a polyline into lines" },
			],
		},
		{
			id: "arrange",
			label: "Arrange",
			items: [
				{ id: "array-rect", name: "grid-3x3", label: "Rectangular array" },
				{ id: "array-polar", name: "orbit", label: "Polar array" },
				{ id: "match-props", name: "pipette", label: "Match properties" },
			],
		},
		{
			id: "annotate",
			label: "Annotate",
			items: [
				{ id: "dimension-linear", name: "ruler", label: "Linear dimension" },
				{ id: "annotate", name: "sticky-note", label: "Add note (annotation)" },
			],
		},
	];

	let activeGroup = groups[0].id;
	$: activeItems = groups.find((g) => g.id === activeGroup)?.items ?? [];
</script>

<div class="dxf-ribbon">
	<div class="dxf-ribbon-tabs">
		{#each groups as g}
			<button class="dxf-ribbon-tab" class:is-active={activeGroup === g.id} on:click={() => (activeGroup = g.id)}>
				{g.label}
			</button>
		{/each}
	</div>
	<div class="dxf-ribbon-items">
		{#each activeItems as item (item.id)}
			<button
				class="dxf-tool-btn"
				class:is-active={state.activeTool === item.id}
				title={item.label}
				aria-label={item.label}
				on:click={() => controller.setTool(item.id)}
				use:icon={item.name}
			/>
		{/each}
	</div>
</div>
