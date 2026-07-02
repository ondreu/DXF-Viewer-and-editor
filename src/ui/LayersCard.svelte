<script lang="ts">
	import Card from "./Card.svelte";
	import { icon } from "./actions";
	import type { ViewController, ControllerState } from "../view/ViewController";
	import type { LayerInfo } from "../core/model/types";

	export let controller: ViewController;
	export let state: ControllerState;
	export let onClose: () => void;

	let newName = "";
	let expanded: string | null = null;

	const swatch = (c: number) => "#" + (c & 0xffffff).toString(16).padStart(6, "0");

	const ACI = [
		{ v: 1, name: "Red" }, { v: 2, name: "Yellow" }, { v: 3, name: "Green" },
		{ v: 4, name: "Cyan" }, { v: 5, name: "Blue" }, { v: 6, name: "Magenta" },
		{ v: 7, name: "White/Black" }, { v: 8, name: "Dark grey" }, { v: 9, name: "Light grey" },
	];
	const LINETYPES = ["CONTINUOUS", "DASHED", "DOTTED", "DASHDOT", "CENTER", "HIDDEN", "PHANTOM"];
	const LINEWEIGHTS = [-3, 0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100, 120, 140, 200];

	function onActiveLayer(e: Event) {
		controller.setActiveLayer((e.target as HTMLSelectElement).value);
	}
	function onActiveColor(e: Event) {
		const v = (e.target as HTMLSelectElement).value;
		controller.setActiveColor(v === "BYLAYER" ? null : parseInt(v, 10));
	}
	function addLayer() {
		if (!newName.trim()) return;
		controller.addLayer(newName, { colorIndex: 7, lineType: "CONTINUOUS" });
		controller.setActiveLayer(newName.trim());
		newName = "";
	}
	function setColor(l: LayerInfo, e: Event) {
		controller.updateLayer(l.name, { colorIndex: parseInt((e.target as HTMLSelectElement).value, 10) });
	}
	function setLineType(l: LayerInfo, e: Event) {
		controller.updateLayer(l.name, { lineType: (e.target as HTMLSelectElement).value });
	}
	function setLineWeight(l: LayerInfo, e: Event) {
		controller.updateLayer(l.name, { lineWeight: parseInt((e.target as HTMLSelectElement).value, 10) });
	}
	const lwLabel = (v: number) => (v === -3 ? "Default" : (v / 100).toFixed(2) + " mm");
</script>

<Card title="Layers" anchor="anchor-tl-2" {onClose}>
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
				{#each ACI as c}<option value={String(c.v)}>{c.v} · {c.name}</option>{/each}
			</select>
		</span>
	</div>

	<div class="dxf-add-layer">
		<input class="dxf-num" type="text" placeholder="New layer name" bind:value={newName} on:keydown={(e) => e.key === "Enter" && addLayer()} />
		<button class="dxf-icon-btn" title="Add layer" on:click={addLayer} use:icon={"plus"} />
	</div>

	{#if state.layers.length}
		<ul class="dxf-layer-list">
			{#each state.layers as l (l.name)}
				<li class="dxf-layer-row">
					<button class="dxf-icon-btn" class:is-off={l.visible === false} title={l.visible === false ? "Turn on" : "Turn off"} on:click={() => controller.toggleLayerVisible(l.name)} use:icon={l.visible === false ? "eye-off" : "eye"} />
					<button class="dxf-icon-btn" class:is-active={l.frozen} title={l.frozen ? "Thaw" : "Freeze"} on:click={() => controller.toggleLayerFrozen(l.name)} use:icon={l.frozen ? "snowflake" : "flame"} />
					<span class="dxf-layer-swatch" style="background:{swatch(l.color)}" />
					<span class="dxf-layer-name">{l.name}</span>
					<button class="dxf-icon-btn" title="Edit layer" on:click={() => (expanded = expanded === l.name ? null : l.name)} use:icon={"settings-2"} />
				</li>
				{#if expanded === l.name}
					<li class="dxf-layer-edit">
						<div class="dxf-kv">
							<span class="dxf-k">Colour</span>
							<span class="dxf-v">
								<select class="dropdown" value={String(l.colorIndex ?? 7)} on:change={(e) => setColor(l, e)}>
									{#each ACI as c}<option value={String(c.v)}>{c.v} · {c.name}</option>{/each}
									{#if l.colorIndex !== undefined && l.colorIndex > 9}<option value={String(l.colorIndex)}>{l.colorIndex}</option>{/if}
								</select>
							</span>
							<span class="dxf-k">Linetype</span>
							<span class="dxf-v">
								<select class="dropdown" value={l.lineType ?? "CONTINUOUS"} on:change={(e) => setLineType(l, e)}>
									{#each LINETYPES as lt}<option value={lt}>{lt}</option>{/each}
									{#if l.lineType && !LINETYPES.includes(l.lineType)}<option value={l.lineType}>{l.lineType}</option>{/if}
								</select>
							</span>
							<span class="dxf-k">Lineweight</span>
							<span class="dxf-v">
								<select class="dropdown" value={String(l.lineWeight ?? -3)} on:change={(e) => setLineWeight(l, e)}>
									{#each LINEWEIGHTS as w}<option value={String(w)}>{lwLabel(w)}</option>{/each}
								</select>
							</span>
						</div>
					</li>
				{/if}
			{/each}
		</ul>
	{:else}
		<div class="dxf-note">No layer table in this file. Added layers apply to new geometry.</div>
	{/if}
</Card>
