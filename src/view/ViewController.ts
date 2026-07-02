import { DxfDocument } from "../core/model/DxfDocument";
import { DxfRenderer } from "../render/DxfRenderer";
import { CommandStack } from "../core/command/CommandStack";
import {
	MoveCommand,
	DeleteCommand,
	ChangeLayerCommand,
	ChangeColorCommand,
	type Command,
} from "../core/command/commands";
import { EventEmitter } from "../core/events/EventEmitter";
import type { ParseResult, RenderEntity, LayerInfo } from "../core/model/types";
import type { RenderTheme } from "../render/theme";
import type { Overlay } from "../render/overlay";
import { ToolManager } from "../interaction/ToolManager";
import type { ToolContext, ToolId, Measurement } from "../interaction/types";
import { computeSnap, DEFAULT_SNAP, type SnapSettings, type SnapResult } from "../interaction/snap";
import { AnnotationStore } from "../core/annotation/AnnotationStore";
import type { Annotation } from "../core/annotation/types";

const ANNOTATION_COLOR = 0xe0a030;
const SNAP_PIXELS = 12;

export interface ControllerState {
	selected: RenderEntity | null;
	editable: boolean;
	canUndo: boolean;
	canRedo: boolean;
	dirty: boolean;
	activeTool: ToolId;
	hint: string;
	measurement: Measurement | null;
	layers: LayerInfo[];
	activeLayer: string;
	activeColor: number | null;
	gridVisible: boolean;
	snap: SnapSettings;
	annotations: readonly Annotation[];
}

export type ControllerEvents = { state: ControllerState };

export interface ViewControllerOptions {
	theme: Partial<RenderTheme>;
	promptText: (initial: string) => Promise<string | null>;
}

/**
 * The single bridge the Svelte UI talks to. Owns the renderer, document model,
 * command stack, snap settings, tool manager and annotation store, and exposes
 * a flat reactive state. The rendering/interaction layers below it never import
 * Svelte (design doc §3).
 */
export class ViewController {
	readonly events = new EventEmitter<ControllerEvents>();
	readonly renderer: DxfRenderer;
	readonly annotations = new AnnotationStore();

	private doc: DxfDocument | null = null;
	private stack: CommandStack | null = null;
	private tools: ToolManager;
	private selectedId: string | null = null;

	private accent: number;
	private snapSettings: SnapSettings = { ...DEFAULT_SNAP };
	private gridVisible = true;
	private activeLayerName = "0";
	private activeColorAci: number | null = null;
	private measurement: Measurement | null = null;
	private toolOverlay: Overlay = [];
	private promptText: (initial: string) => Promise<string | null>;

	constructor(container: HTMLElement, opts: ViewControllerOptions) {
		this.renderer = new DxfRenderer(container, opts.theme);
		this.accent = (opts.theme.accent as number) ?? 0x7f6df2;
		this.promptText = opts.promptText;

		this.renderer.events.on("select", ({ id }) => {
			this.selectedId = id;
			this.emit();
		});

		this.tools = new ToolManager(this.buildToolContext(), this.renderer, () => this.emit());
		this.annotations.events.on("change", () => {
			this.composeOverlay();
			this.emit();
		});
	}

	private buildToolContext(): ToolContext {
		return {
			doc: () => this.doc,
			snap: (world) => this.snapAt(world),
			pick: (world) => this.renderer.pickAt(world),
			execute: (cmd: Command) => {
				this.stack?.execute(cmd);
				this.renderer.rebuild();
				this.emit();
			},
			select: (id) => this.renderer.select(id),
			setOverlay: (prims) => {
				this.toolOverlay = prims;
				this.composeOverlay();
			},
			reportMeasurement: (m) => {
				this.measurement = m;
				this.emit();
			},
			addAnnotation: (a) => this.annotations.add(a),
			promptText: (initial) => this.promptText(initial),
			activeLayer: () => this.activeLayerName,
			activeColor: () => this.activeColorAci,
			pixelSize: () => this.renderer.pixelSize,
			accent: this.accent,
			touch: () => this.emit(),
		};
	}

	private snapAt(world: { x: number; y: number }): SnapResult | null {
		if (!this.doc) return null;
		const tol = this.renderer.pixelsToWorld(SNAP_PIXELS);
		return computeSnap(world, this.doc.entities, this.snapSettings, tol, (id) => !!this.doc?.isDeleted(id));
	}

	load(result: ParseResult, annotationJSON: string | null): void {
		this.doc = DxfDocument.fromResult(result);
		this.stack = new CommandStack(this.doc);
		this.stack.events.on("change", () => this.emit());
		this.selectedId = null;
		this.measurement = null;
		this.activeLayerName = result.layers[0]?.name ?? "0";
		this.annotations.loadJSON(annotationJSON);
		this.renderer.loadDocument(this.doc);
		this.renderer.setGridVisible(this.gridVisible);
		this.composeOverlay();
		this.emit();
	}

	private composeOverlay(): void {
		this.renderer.setOverlay([...this.annotations.toOverlay(ANNOTATION_COLOR), ...this.toolOverlay]);
	}

	get document(): DxfDocument | null {
		return this.doc;
	}

	getState(): ControllerState {
		const selected = this.selectedId ? this.doc?.getEntity(this.selectedId) ?? null : null;
		return {
			selected,
			editable: !!(this.selectedId && this.doc?.isEditable(this.selectedId)),
			canUndo: this.stack?.canUndo ?? false,
			canRedo: this.stack?.canRedo ?? false,
			dirty: (this.stack?.dirty ?? false) || this.annotations.isDirty,
			activeTool: this.tools.activeId,
			hint: this.tools.activeHint(),
			measurement: this.measurement,
			layers: this.doc?.layers ?? [],
			activeLayer: this.activeLayerName,
			activeColor: this.activeColorAci,
			gridVisible: this.gridVisible,
			snap: this.snapSettings,
			annotations: this.annotations.all,
		};
	}

	private emit(): void {
		this.events.emit("state", this.getState());
	}

	// -- UI actions -----------------------------------------------------------

	setTool(id: ToolId): void {
		this.toolOverlay = [];
		this.measurement = null;
		this.tools.setActive(id);
		this.composeOverlay();
		this.emit();
	}

	setActiveLayer(name: string): void {
		this.activeLayerName = name;
		this.emit();
	}

	setActiveColor(aci: number | null): void {
		this.activeColorAci = aci;
		this.emit();
	}

	toggleGrid(): void {
		this.gridVisible = !this.gridVisible;
		this.renderer.setGridVisible(this.gridVisible);
		this.emit();
	}

	setSnap(patch: Partial<SnapSettings>): void {
		this.snapSettings = { ...this.snapSettings, ...patch };
		this.emit();
	}

	saveMeasurementAsAnnotation(): void {
		if (!this.measurement) return;
		// Reconstruct anchor points from the current tool overlay lines, if any.
		const line = this.toolOverlay.find((p) => p.kind === "line");
		const points = line && line.kind === "line" ? line.pts : [];
		this.annotations.add({
			id: AnnotationStore.newId(),
			kind: "measure",
			points: points.length ? points : [{ x: 0, y: 0 }],
			data: this.measurement,
		});
	}

	removeAnnotation(id: string): void {
		this.annotations.remove(id);
	}

	private execEdit(cmd: Command, id: string): void {
		if (!this.stack) return;
		this.stack.execute(cmd);
		this.renderer.refreshEntity(id);
		this.emit();
	}

	moveSelected(dx: number, dy: number): void {
		const id = this.selectedId;
		if (id && this.doc?.isEditable(id)) this.execEdit(new MoveCommand(id, dx, dy), id);
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
		if (id && this.doc?.isEditable(id)) this.execEdit(new ChangeLayerCommand(id, layer), id);
	}

	changeColor(aci: number | null): void {
		const id = this.selectedId;
		if (id && this.doc?.isEditable(id)) this.execEdit(new ChangeColorCommand(id, aci), id);
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
		if (this.selectedId && (this.doc?.isDeleted(this.selectedId) || !this.doc?.getEntity(this.selectedId))) {
			this.selectedId = null;
			this.renderer.select(null, false);
		}
		this.emit();
	}

	fit(): void {
		this.renderer.fit();
	}

	handleKey(ev: KeyboardEvent): boolean {
		return this.tools.handleKey(ev);
	}

	// -- persistence ----------------------------------------------------------

	serializeDxf(): string | null {
		return this.doc?.serialize() ?? null;
	}

	get dxfDirty(): boolean {
		return this.stack?.dirty ?? false;
	}

	get annotationsDirty(): boolean {
		return this.annotations.isDirty;
	}

	annotationsJSON(drawing?: string): string {
		return this.annotations.toJSON(drawing);
	}

	markDxfSaved(): void {
		this.stack?.markSaved();
		this.emit();
	}

	markAnnotationsSaved(): void {
		this.annotations.markSaved();
		this.emit();
	}

	setTheme(theme: Partial<RenderTheme>): void {
		if (theme.accent !== undefined) this.accent = theme.accent as number;
		this.renderer.setTheme(theme);
	}

	dispose(): void {
		this.renderer.dispose();
		this.events.clear();
		this.annotations.events.clear();
	}
}
