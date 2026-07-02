import { DxfDocument } from "../core/model/DxfDocument";
import { DxfRenderer } from "../render/DxfRenderer";
import { CommandStack } from "../core/command/CommandStack";
import {
	MoveCommand,
	DeleteCommand,
	ChangeLayerCommand,
	ChangeColorCommand,
} from "../core/command/commands";
import { EventEmitter } from "../core/events/EventEmitter";
import type { ParseResult, RenderEntity } from "../core/model/types";
import type { RenderTheme } from "../render/theme";

export interface ControllerState {
	selected: RenderEntity | null;
	editable: boolean;
	canUndo: boolean;
	canRedo: boolean;
	dirty: boolean;
}

export type ControllerEvents = {
	state: ControllerState;
};

/**
 * Framework-agnostic glue between the renderer, document model and command
 * stack. The Svelte UI reads/writes only through this object and its events —
 * keeping the rendering layer free of any Svelte dependency (design doc §3).
 */
export class ViewController {
	readonly events = new EventEmitter<ControllerEvents>();
	readonly renderer: DxfRenderer;
	private doc: DxfDocument | null = null;
	private stack: CommandStack | null = null;
	private selectedId: string | null = null;

	constructor(container: HTMLElement, theme: Partial<RenderTheme>) {
		this.renderer = new DxfRenderer(container, theme);
		this.renderer.events.on("select", ({ id }) => {
			this.selectedId = id;
			this.emit();
		});
	}

	load(result: ParseResult): void {
		this.doc = new DxfDocument(
			result.tags,
			result.newline,
			result.ranges,
			result.entities,
			result.layers,
			result.fullyAddressable
		);
		this.stack = new CommandStack(this.doc);
		this.stack.events.on("change", () => this.emit());
		this.selectedId = null;
		this.renderer.loadDocument(this.doc);
		this.emit();
	}

	get document(): DxfDocument | null {
		return this.doc;
	}

	get layers() {
		return this.doc?.layers ?? [];
	}

	getState(): ControllerState {
		const selected = this.selectedId ? this.doc?.getEntity(this.selectedId) ?? null : null;
		return {
			selected,
			editable: !!(this.selectedId && this.doc?.isEditable(this.selectedId)),
			canUndo: this.stack?.canUndo ?? false,
			canRedo: this.stack?.canRedo ?? false,
			dirty: this.stack?.dirty ?? false,
		};
	}

	private emit(): void {
		this.events.emit("state", this.getState());
	}

	// -- edit actions (no-ops when nothing editable is selected) --------------

	moveSelected(dx: number, dy: number): void {
		const id = this.selectedId;
		if (!id || !this.doc?.isEditable(id) || !this.stack) return;
		this.stack.execute(new MoveCommand(id, dx, dy));
		this.renderer.refreshEntity(id);
		this.emit();
	}

	deleteSelected(): void {
		const id = this.selectedId;
		if (!id || !this.doc?.isEditable(id) || !this.stack) return;
		this.stack.execute(new DeleteCommand(id));
		this.renderer.refreshEntity(id);
		this.renderer.select(null, false);
		this.selectedId = null;
		this.emit();
	}

	changeLayer(layer: string): void {
		const id = this.selectedId;
		if (!id || !this.doc?.isEditable(id) || !this.stack) return;
		this.stack.execute(new ChangeLayerCommand(id, layer));
		this.renderer.refreshEntity(id);
		this.emit();
	}

	changeColor(aci: number | null): void {
		const id = this.selectedId;
		if (!id || !this.doc?.isEditable(id) || !this.stack) return;
		this.stack.execute(new ChangeColorCommand(id, aci));
		this.renderer.refreshEntity(id);
		this.emit();
	}

	undo(): void {
		this.stack?.undo();
		this.renderer.rebuild();
		this.reconcileSelection();
	}

	redo(): void {
		this.stack?.redo();
		this.renderer.rebuild();
		this.reconcileSelection();
	}

	private reconcileSelection(): void {
		if (this.selectedId && this.doc?.isDeleted(this.selectedId)) {
			this.selectedId = null;
			this.renderer.select(null, false);
		}
		this.emit();
	}

	fit(): void {
		this.renderer.fit();
	}

	/** Serialize the current document to DXF text (patched raw passthrough). */
	serialize(): string | null {
		return this.doc?.serialize() ?? null;
	}

	markSaved(): void {
		this.stack?.markSaved();
		this.emit();
	}

	get dirty(): boolean {
		return this.stack?.dirty ?? false;
	}

	setTheme(theme: Partial<RenderTheme>): void {
		this.renderer.setTheme(theme);
	}

	dispose(): void {
		this.renderer.dispose();
		this.events.clear();
	}
}
