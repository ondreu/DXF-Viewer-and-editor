<script lang="ts">
	import Card from "./Card.svelte";
	import { icon } from "./actions";
	import type { ViewController, ControllerState } from "../view/ViewController";

	export let controller: ViewController;
	export let state: ControllerState;
	export let onClose: () => void;

	const summary = (a: import("../core/annotation/types").Annotation): string => {
		if (a.kind === "note") return a.text;
		if (a.kind === "arrow") return a.text ?? "arrow";
		if (a.kind === "rect") return a.text ?? "rectangle";
		return `measure`;
	};
</script>

<Card title="Annotations" anchor="anchor-tr-2" {onClose}>
	{#if state.annotations.length === 0}
		<div class="dxf-note">None yet. Use the note tool or “Save as annotation”.</div>
	{:else}
		<ul class="dxf-anno-list">
			{#each state.annotations as a}
				<li class="dxf-anno-row">
					<span class="dxf-anno-kind">{a.kind}</span>
					<span class="dxf-anno-text">{summary(a)}</span>
					<button class="dxf-icon-btn danger" title="Delete" on:click={() => controller.removeAnnotation(a.id)} use:icon={"trash-2"} />
				</li>
			{/each}
		</ul>
	{/if}
</Card>
