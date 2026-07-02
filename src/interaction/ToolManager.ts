import type { DxfRenderer } from "../render/DxfRenderer";
import type { Tool, ToolContext, ToolId } from "./types";
import { createTools } from "./tools";

/**
 * Owns the tool set and the active tool, and bridges renderer pointer/keyboard
 * input to it. Switching tools updates the renderer's pan behaviour (Select
 * pans on left-drag; draw/measure tools reserve left-drag for their own use).
 */
export class ToolManager {
	private tools: Record<ToolId, Tool>;
	private active: Tool;

	constructor(
		ctx: ToolContext,
		private renderer: DxfRenderer,
		private onChange: (id: ToolId) => void
	) {
		this.tools = createTools(ctx);
		this.active = this.tools.select;
		this.renderer.setPointerHandler((phase, world, ev) => this.active.pointer(phase, world, ev));
		this.apply();
	}

	get activeId(): ToolId {
		return this.active.id;
	}

	activeHint(): string {
		return this.active.hint();
	}

	setActive(id: ToolId): void {
		if (id === this.active.id) return;
		this.active.deactivate?.();
		this.active = this.tools[id];
		this.apply();
		this.active.activate?.();
		this.onChange(id);
	}

	handleKey(ev: KeyboardEvent): boolean {
		return this.active.key?.(ev) ?? false;
	}

	private apply(): void {
		this.renderer.panWithLeftDrag = this.active.panWithLeftDrag;
	}
}
