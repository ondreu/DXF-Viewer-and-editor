import { setIcon } from "obsidian";

/** Svelte action: render an Obsidian (lucide) icon into the node. */
export function icon(node: HTMLElement, name: string) {
	setIcon(node, name);
	return {
		update(next: string) {
			node.empty();
			setIcon(node, next);
		},
	};
}

/**
 * Svelte action: make a floating card draggable by a handle element. The handle
 * is any descendant carrying [data-drag-handle]. Position is applied to the node
 * as left/top so cards can be nudged out of the way — deliberately lightweight,
 * no library.
 */
export function draggable(node: HTMLElement) {
	let startX = 0;
	let startY = 0;
	let originLeft = 0;
	let originTop = 0;
	let dragging = false;

	const onDown = (ev: PointerEvent) => {
		const target = ev.target as HTMLElement;
		const handle = target.closest("[data-drag-handle]");
		if (!handle || !node.contains(handle)) return;
		dragging = true;
		startX = ev.clientX;
		startY = ev.clientY;
		const rect = node.getBoundingClientRect();
		const parent = node.offsetParent as HTMLElement | null;
		const prect = parent?.getBoundingClientRect() ?? { left: 0, top: 0 };
		originLeft = rect.left - prect.left;
		originTop = rect.top - prect.top;
		node.style.left = originLeft + "px";
		node.style.top = originTop + "px";
		node.style.right = "auto";
		node.style.bottom = "auto";
		(handle as HTMLElement).setPointerCapture(ev.pointerId);
		ev.preventDefault();
	};
	const onMove = (ev: PointerEvent) => {
		if (!dragging) return;
		node.style.left = originLeft + (ev.clientX - startX) + "px";
		node.style.top = originTop + (ev.clientY - startY) + "px";
	};
	const onUp = () => {
		dragging = false;
	};

	node.addEventListener("pointerdown", onDown);
	window.addEventListener("pointermove", onMove);
	window.addEventListener("pointerup", onUp);
	return {
		destroy() {
			node.removeEventListener("pointerdown", onDown);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		},
	};
}
