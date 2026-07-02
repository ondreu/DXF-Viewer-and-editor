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
			{:else}
				<span class="dxf-k">Angle</span><span class="dxf-v dxf-mono">{m.angleDeg.toFixed(3)}°</span>
			{/if}
		</div>
		<button class="dxf-text-btn" on:click={() => controller.saveMeasurementAsAnnotation()}>
			Save as annotation
		</button>
	</Card>
{/if}
