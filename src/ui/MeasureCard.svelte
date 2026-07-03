<script lang="ts">
	import Card from "./Card.svelte";
	import type { ViewController, ControllerState } from "../view/ViewController";

	export let controller: ViewController;
	export let state: ControllerState;

	$: m = state.measurement;
</script>

{#if m}
	<Card title="Measurement" anchor="anchor-bl" onClose={() => controller.clearMeasurement()}>
		<div class="dxf-kv">
			{#if m.kind === "distance"}
				<span class="dxf-k">Length</span><span class="dxf-v dxf-mono">{m.length.toFixed(4)}</span>
				<span class="dxf-k">Δx</span><span class="dxf-v dxf-mono">{m.dx.toFixed(4)}</span>
				<span class="dxf-k">Δy</span><span class="dxf-v dxf-mono">{m.dy.toFixed(4)}</span>
				<span class="dxf-k">Angle</span><span class="dxf-v dxf-mono">{m.angleDeg.toFixed(2)}°</span>
			{:else if m.kind === "radius"}
				<span class="dxf-k">Radius</span><span class="dxf-v dxf-mono">{m.radius.toFixed(4)}</span>
				<span class="dxf-k">Diameter</span><span class="dxf-v dxf-mono">{m.diameter.toFixed(4)}</span>
				<span class="dxf-k">Circumf.</span><span class="dxf-v dxf-mono">{m.circumference.toFixed(4)}</span>
			{:else if m.kind === "area"}
				<span class="dxf-k">Area</span><span class="dxf-v dxf-mono">{m.area.toFixed(4)}</span>
				<span class="dxf-k">Perimeter</span><span class="dxf-v dxf-mono">{m.perimeter.toFixed(4)}</span>
			{:else if m.kind === "point"}
				<span class="dxf-k">X</span><span class="dxf-v dxf-mono">{m.x.toFixed(4)}</span>
				<span class="dxf-k">Y</span><span class="dxf-v dxf-mono">{m.y.toFixed(4)}</span>
			{:else}
				<span class="dxf-k">Angle</span><span class="dxf-v dxf-mono">{m.angleDeg.toFixed(3)}°</span>
			{/if}
		</div>
	</Card>
{/if}
