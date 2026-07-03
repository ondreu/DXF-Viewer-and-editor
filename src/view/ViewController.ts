import { DxfDocument } from "../core/model/DxfDocument";
import { DxfRenderer } from "../render/DxfRenderer";
import { CommandStack } from "../core/command/CommandStack";
import {
	MoveCommand,
	DeleteCommand,
	ChangeLayerCommand,
	ChangeColorCommand,
	SetPropsCommand,
	SetAnchorCommand,
	RotateCommand,
	AddLayerCommand,
	UpdateLayerCommand,
	type Command,
} from "../core/command/commands";
import type { PropPatch, LayerPatch } from "../core/model/DxfDocument";
import { EventEmitter } from "../core/events/EventEmitter";
import type { ParseResult, RenderEntity, LayerInfo, Point2 } from "../core/model/types";
import type { RenderTheme } from "../render/theme";
import type { Overlay } from "../render/overlay";
import { ToolManager } from "../interaction/ToolManager";
import type { ToolContext, ToolId, Measurement } from "../interaction/types";
import { computeSnap, DEFAULT_SNAP, type SnapSettings, type SnapResult } from "../interaction/snap";
import { AnnotationStore } from "../core/annotation/AnnotationStore";
import type { Annotation } from "../core/annotation/types";
import { entityLength } from "../core/geom/geometry2d";

const ANNOTATION_COLOR = 0xe0a030;
const SNAP_PIXELS = 12;

export interface ControllerState {
	selected: RenderEntity | null;
	/** number of currently selected entities (multi-select) */
	selectionCount: number;
	/** combined perimeter/arc-length of every selected entity */
	selectionLength: number;
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
	isolating: boolean;
	snap: SnapSettings;
	annotations: readonly Annotation[];
}

export type ControllerEvents = { state: ControllerState };

export interface ViewControllerOptions {
	theme: Partial<RenderTheme>;
	promptText: (initial: string, title?: string) => Promise<string | null>;
	/** live getter so a settings change while the view is open takes effect immediately */
	toolStickiness?: () => "sticky" | "auto-select";
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
	private selection = new Set<string>();
	private lastMeasurePoints: Point2[] = [];

	private accent: number;
	private snapSettings: SnapSettings = { ...DEFAULT_SNAP };
	private gridVisible = true;
	private activeLayerName = "0";
	private activeColorAci: number | null = null;
	private measurement: Measurement | null = null;
	private toolOverlay: Overlay = [];
	private promptText: (initial: string, title?: string) => Promise<string | null>;
	private toolStickiness: () => "sticky" | "auto-select";

	constructor(container: HTMLElement, opts: ViewControllerOptions) {
		this.renderer = new DxfRenderer(container, opts.theme);
		this.accent = (opts.theme.accent as number) ?? 0x7f6df2;
		this.promptText = opts.promptText;
		this.toolStickiness = opts.toolStickiness ?? (() => "sticky");

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
			orthoEnabled: () => this.snapSettings.ortho,
			pick: (world) => this.renderer.pickAt(world),
			execute: (cmd: Command) => {
				this.stack?.execute(cmd);
				this.renderer.rebuild();
				this.syncAttachedAnnotations();
				// "auto-select" stickiness: hand control back to Select as soon as a
				// tool finishes a discrete action, instead of staying on the tool.
				if (this.toolStickiness() === "auto-select" && this.tools.activeId !== "select") this.tools.setActive("select");
				this.emit();
			},
			select: (id) => this.setSelectionIds(id ? [id] : []),
			selectMany: (ids) => this.setSelectionIds(ids),
			toggleSelection: (id) => this.toggleSelection(id),
			selectedId: () => this.selectedId,
			selectedIds: () => [...this.selection],
			annotationAt: (world) => this.annotationAt(world),
			moveAnnotationTo: (id, at, attachTo) => this.moveAnnotationTo(id, at, attachTo),
			setOverlay: (prims) => {
				this.toolOverlay = prims;
				this.composeOverlay();
			},
			reportMeasurement: (m, points) => {
				this.measurement = m;
				if (points) this.lastMeasurePoints = points;
				this.emit();
			},
			addAnnotation: (a) => this.annotations.add(a),
			promptText: (initial, title) => this.promptText(initial, title),
			activeLayer: () => this.activeLayerName,
			activeColor: () => this.activeColorAci,
			pixelSize: () => this.renderer.pixelSize,
			accent: this.accent,
			touch: () => this.emit(),
		};
	}

	private annotationAt(world: { x: number; y: number }): string | null {
		const tol = this.renderer.pixelsToWorld(14);
		let best: string | null = null;
		let bestD = tol;
		for (const a of this.annotations.all) {
			if (a.kind !== "note") continue;
			const d = Math.hypot(a.at.x - world.x, a.at.y - world.y);
			if (d <= bestD) {
				bestD = d;
				best = a.id;
			}
		}
		return best;
	}

	private moveAnnotationTo(id: string, at: { x: number; y: number }, attachTo: string | null): void {
		if (attachTo && this.doc) {
			const anchor = this.doc.anchorOf(attachTo);
			if (anchor) {
				this.annotations.update(id, { at, attachedTo: attachTo, offset: { x: at.x - anchor.x, y: at.y - anchor.y } });
				return;
			}
		}
		this.annotations.update(id, { at, attachedTo: undefined, offset: undefined });
	}

	/** Reposition notes pinned to entities after any geometry edit. */
	private syncAttachedAnnotations(): void {
		if (!this.doc) return;
		for (const a of this.annotations.all) {
			if (a.kind !== "note" || !a.attachedTo) continue;
			const anchor = this.doc.anchorOf(a.attachedTo);
			if (!anchor) {
				this.annotations.update(a.id, { attachedTo: undefined, offset: undefined });
				continue;
			}
			const off = a.offset ?? { x: 0, y: 0 };
			this.annotations.update(a.id, { at: { x: anchor.x + off.x, y: anchor.y + off.y } });
		}
	}

	clearMeasurement(): void {
		this.measurement = null;
		this.toolOverlay = [];
		this.composeOverlay();
		this.emit();
	}

	screenshotPNG(): string {
		return this.renderer.snapshot();
	}

	private snapAt(world: { x: number; y: number }): SnapResult | null {
		if (!this.doc) return null;
		const tol = this.renderer.pixelsToWorld(SNAP_PIXELS);
		return computeSnap(world, this.doc.entities, this.snapSettings, tol, (id) => !!this.doc?.isHidden(id));
	}

	/** Primary (last) entity of the current selection. */
	private get selectedId(): string | null {
		let last: string | null = null;
		for (const id of this.selection) last = id;
		return last;
	}

	private setSelectionIds(ids: string[]): void {
		this.selection = new Set(ids.filter((id) => this.doc?.getEntity(id) && !this.doc.isHidden(id)));
		this.renderer.setSelection([...this.selection]);
		this.emit();
	}

	private toggleSelection(id: string | null): void {
		if (!id) return;
		if (this.selection.has(id)) this.selection.delete(id);
		else if (this.doc?.getEntity(id) && !this.doc.isHidden(id)) this.selection.add(id);
		this.renderer.setSelection([...this.selection]);
		this.emit();
	}

	clearSelection(): void {
		this.setSelectionIds([]);
	}

	load(result: ParseResult, annotationJSON: string | null): void {
		this.doc = DxfDocument.fromResult(result);
		this.stack = new CommandStack(this.doc);
		this.stack.events.on("change", () => this.emit());
		this.selection = new Set();
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
		let selectionLength = 0;
		for (const id of this.selection) {
			const e = this.doc?.getEntity(id);
			if (e) selectionLength += entityLength(e);
		}
		return {
			selected,
			selectionCount: this.selection.size,
			selectionLength,
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
			isolating: this.doc?.isIsolating ?? false,
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

	/** Show only the layer(s) of the current selection; toggling again (or with
	 * nothing selected) restores every layer. Purely a view state — never touches
	 * saved layer visibility or the undo stack. */
	toggleIsolate(): void {
		if (!this.doc) return;
		if (this.doc.isIsolating) {
			this.doc.setIsolatedLayers(null);
		} else {
			const names = new Set<string>();
			for (const id of this.selection) {
				const e = this.doc.getEntity(id);
				if (e) names.add(e.layer);
			}
			if (!names.size) return;
			this.doc.setIsolatedLayers([...names]);
		}
		this.renderer.rebuild();
		this.reconcileSelection();
	}

	setSnap(patch: Partial<SnapSettings>): void {
		this.snapSettings = { ...this.snapSettings, ...patch };
		this.emit();
	}

	saveMeasurementAsAnnotation(): void {
		if (!this.measurement) return;
		// Points captured when the measurement completed (robust across mouse moves).
		const points = this.lastMeasurePoints.length ? this.lastMeasurePoints.map((p) => ({ ...p })) : [{ x: 0, y: 0 }];
		this.annotations.add({
			id: AnnotationStore.newId(),
			kind: "measure",
			points,
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
		this.syncAttachedAnnotations();
		this.emit();
	}

	/** Editable entities in the current selection (frozen/locked ones excluded). */
	private editableSelection(): string[] {
		return [...this.selection].filter((id) => this.doc?.isEditable(id));
	}

	moveSelected(dx: number, dy: number): void {
		const ids = this.editableSelection();
		if (!ids.length || !this.stack) return;
		for (const id of ids) {
			this.stack.execute(new MoveCommand(id, dx, dy));
			this.renderer.refreshEntity(id);
		}
		this.syncAttachedAnnotations();
		this.emit();
	}

	deleteSelected(): void {
		const ids = this.editableSelection();
		if (!ids.length || !this.stack) return;
		for (const id of ids) {
			this.stack.execute(new DeleteCommand(id));
			this.renderer.refreshEntity(id);
		}
		this.selection = new Set();
		this.renderer.setSelection([]);
		this.emit();
	}

	changeLayer(layer: string): void {
		const ids = this.editableSelection();
		if (!ids.length || !this.stack) return;
		for (const id of ids) {
			this.stack.execute(new ChangeLayerCommand(id, layer));
			this.renderer.refreshEntity(id);
		}
		this.emit();
	}

	changeColor(aci: number | null): void {
		const ids = this.editableSelection();
		if (!ids.length || !this.stack) return;
		for (const id of ids) {
			this.stack.execute(new ChangeColorCommand(id, aci));
			this.renderer.refreshEntity(id);
		}
		this.emit();
	}

	/** Set precise scalar properties on the primary selected entity. */
	setSelectedProps(patch: PropPatch): void {
		const id = this.selectedId;
		if (id && this.doc?.isEditable(id)) this.execEdit(new SetPropsCommand(id, patch), id);
	}

	/** Place the primary selected entity's anchor at an exact coordinate. */
	setSelectedAnchor(x: number, y: number): void {
		const id = this.selectedId;
		if (id && this.doc?.isEditable(id)) this.execEdit(new SetAnchorCommand(id, x, y), id);
	}

	/** Rotate the whole selection about a pivot (defaults to selection centroid). */
	rotateSelected(deg: number, pivot?: Point2): void {
		const ids = this.editableSelection();
		if (!ids.length || !this.stack) return;
		const c = pivot ?? this.selectionCentroid(ids);
		this.stack.execute(new RotateCommand(ids, c.x, c.y, deg));
		this.renderer.rebuild();
		this.syncAttachedAnnotations();
		this.emit();
	}

	private selectionCentroid(ids: string[]): Point2 {
		let x = 0, y = 0, n = 0;
		for (const id of ids) {
			const a = this.doc?.anchorOf(id);
			if (a) { x += a.x; y += a.y; n++; }
		}
		return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
	}

	// -- layer table actions --------------------------------------------------

	addLayer(name: string, patch: LayerPatch = {}): void {
		if (!this.stack || !name.trim()) return;
		this.stack.execute(new AddLayerCommand(name.trim(), patch));
		this.emit();
	}

	updateLayer(name: string, patch: LayerPatch): void {
		if (!this.stack) return;
		this.stack.execute(new UpdateLayerCommand(name, patch));
		// Colour/visibility changes affect what/how entities draw.
		this.renderer.rebuild();
		this.reconcileSelection();
		this.emit();
	}

	toggleLayerVisible(name: string): void {
		const l = this.doc?.layers.find((x) => x.name === name);
		if (l) this.updateLayer(name, { visible: l.visible === false });
	}

	toggleLayerFrozen(name: string): void {
		const l = this.doc?.layers.find((x) => x.name === name);
		if (l) this.updateLayer(name, { frozen: !l.frozen });
	}

	undo(): void {
		this.stack?.undo();
		this.renderer.rebuild();
		this.syncAttachedAnnotations();
		this.reconcileSelection();
	}

	redo(): void {
		this.stack?.redo();
		this.renderer.rebuild();
		this.syncAttachedAnnotations();
		this.reconcileSelection();
	}

	private reconcileSelection(): void {
		// Drop any selected ids that vanished (undone add) or became hidden.
		let changed = false;
		for (const id of [...this.selection]) {
			if (!this.doc?.getEntity(id) || this.doc.isHidden(id)) {
				this.selection.delete(id);
				changed = true;
			}
		}
		if (changed) this.renderer.setSelection([...this.selection]);
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
