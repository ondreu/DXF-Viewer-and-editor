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
		title?: string;
	}
	interface Group {
		id: string;
		label: string;
		items: Item[];
	}

	// "Select" and "Select similar" live outside the tabs, in a cluster that's
	// always visible no matter which tab is open — no more hunting for the
	// cursor tool across tabs.
	const selectItems: Item[] = [
		{ id: "select", name: "mouse-pointer", label: "Select" },
		{ id: "select-similar", name: "list-filter", label: "Similar", title: "Select similar (same type + layer)" },
	];

	const groups: Group[] = [
		{
			id: "measure",
			label: "Measure",
			items: [
				{ id: "measure-distance", name: "ruler", label: "Distance" },
				{ id: "measure-radius", name: "circle-dot", label: "Radius" },
				{ id: "measure-angle", name: "triangle", label: "Angle" },
				{ id: "measure-area", name: "square", label: "Area" },
				{ id: "measure-point", name: "crosshair", label: "Point", title: "Coordinate readout (ID point)" },
			],
		},
		{
			id: "draw",
			label: "Draw",
			items: [
				{ id: "draw-line", name: "pencil", label: "Line" },
				{ id: "draw-circle", name: "circle", label: "Circle", title: "Draw circle (centre + radius)" },
				{ id: "draw-circle-2p", name: "disc", label: "Circle 2P", title: "Draw circle (2-point / diameter)" },
				{ id: "draw-circle-3p", name: "atom", label: "Circle 3P", title: "Draw circle (3-point)" },
				{ id: "draw-arc", name: "spline-pointer", label: "Arc", title: "Draw arc (centre + start + end)" },
				{ id: "draw-arc-3p", name: "waypoints", label: "Arc 3P", title: "Draw arc (3-point)" },
				{ id: "draw-ellipse", name: "egg", label: "Ellipse" },
				{ id: "draw-polyline", name: "spline", label: "Polyline" },
				{ id: "draw-rectangle", name: "rectangle-horizontal", label: "Rectangle" },
				{ id: "draw-polygon", name: "hexagon", label: "Polygon", title: "Draw regular polygon" },
				{ id: "draw-text", name: "type", label: "Text" },
			],
		},
		{
			id: "modify",
			label: "Modify",
			items: [
				{ id: "copy", name: "copy", label: "Copy" },
				{ id: "rotate", name: "rotate-cw", label: "Rotate" },
				{ id: "scale", name: "maximize-2", label: "Scale" },
				{ id: "mirror", name: "flip-horizontal", label: "Mirror" },
				{ id: "fillet", name: "corner-down-right", label: "Fillet", title: "Fillet (round a corner)" },
				{ id: "chamfer", name: "corner-up-right", label: "Chamfer", title: "Chamfer (bevel a corner)" },
				{ id: "trim", name: "scissors", label: "Trim", title: "Trim to a cutting edge" },
				{ id: "extend", name: "move-diagonal", label: "Extend", title: "Extend to a boundary" },
				{ id: "offset", name: "separator-horizontal", label: "Offset", title: "Offset (parallel copy)" },
				{ id: "join", name: "link", label: "Join", title: "Join connected LINEs into a polyline" },
				{ id: "break", name: "unlink", label: "Break", title: "Break a LINE/ARC at a point" },
				{ id: "explode", name: "split", label: "Explode", title: "Explode a polyline into lines" },
			],
		},
		{
			id: "arrange",
			label: "Arrange",
			items: [
				{ id: "array-rect", name: "layout-grid", label: "Rect. array", title: "Rectangular array" },
				{ id: "array-polar", name: "orbit", label: "Polar array" },
				{ id: "match-props", name: "pipette", label: "Match", title: "Match properties" },
			],
		},
		{
			id: "annotate",
			label: "Annotate",
			items: [
				{ id: "dimension-linear", name: "ruler", label: "Dimension", title: "Linear dimension" },
				{ id: "hatch", name: "paint-bucket", label: "Fill", title: "Fill / hatch a closed region" },
				{ id: "annotate", name: "sticky-note", label: "Note", title: "Add note (annotation)" },
			],
		},
	];

	let activeGroup = groups[0].id;
	$: activeItems = groups.find((g) => g.id === activeGroup)?.items ?? [];
	// Jump the ribbon to whichever tab the active tool actually lives in, so
	// switching tools from a card/keyboard shortcut doesn't leave the ribbon
	// pointing at the wrong tab.
	$: {
		const owner = groups.find((g) => g.items.some((it) => it.id === state.activeTool));
		if (owner && owner.id !== activeGroup) activeGroup = owner.id;
	}
</script>

<div class="dxf-ribbon">
	<div class="dxf-ribbon-select">
		{#each selectItems as item (item.id)}
			<button
				class="dxf-tool-btn-lg"
				class:is-active={state.activeTool === item.id}
				title={item.title ?? item.label}
				aria-label={item.title ?? item.label}
				on:click={() => controller.setTool(item.id)}
			>
				<span class="dxf-tool-icon" use:icon={item.name} />
				<span class="dxf-tool-label">{item.label}</span>
			</button>
		{/each}
	</div>
	<div class="dxf-ribbon-sep" />
	<div class="dxf-ribbon-main">
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
					class="dxf-tool-btn-lg"
					class:is-active={state.activeTool === item.id}
					title={item.title ?? item.label}
					aria-label={item.title ?? item.label}
					on:click={() => controller.setTool(item.id)}
				>
					<span class="dxf-tool-icon" use:icon={item.name} />
					<span class="dxf-tool-label">{item.label}</span>
				</button>
			{/each}
		</div>
	</div>
</div>
