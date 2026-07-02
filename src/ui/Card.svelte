<script lang="ts">
	import { draggable, icon } from "./actions";

	export let title: string;
	/** anchor class, e.g. "anchor-tr" / "anchor-bl" */
	export let anchor = "";
	export let onClose: (() => void) | null = null;
	let collapsed = false;
</script>

<div class="dxf-card {anchor}" use:draggable>
	<div class="dxf-card-head" data-drag-handle>
		<span class="dxf-card-title">{title}</span>
		<div class="dxf-card-actions">
			<button
				class="dxf-icon-btn"
				title={collapsed ? "Expand" : "Collapse"}
				on:click={() => (collapsed = !collapsed)}
				use:icon={collapsed ? "chevron-down" : "chevron-up"}
			/>
			{#if onClose}
				<button class="dxf-icon-btn" title="Close" on:click={onClose} use:icon={"x"} />
			{/if}
		</div>
	</div>
	{#if !collapsed}
		<div class="dxf-card-body">
			<slot />
		</div>
	{/if}
</div>
