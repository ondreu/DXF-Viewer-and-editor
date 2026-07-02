import type { DxfDocument, PropPatch, LayerPatch } from "../model/DxfDocument";
import type { NewEntitySpec, Point2 } from "../model/types";

/**
 * A reversible edit. Commands are the *only* way the document is mutated, so
 * undo/redo is exact and scoped to this document (design doc §7 — the file-view
 * command stack is deliberately isolated from Obsidian's editor undo).
 */
export interface Command {
	readonly label: string;
	do(doc: DxfDocument): void;
	undo(doc: DxfDocument): void;
}

export class MoveCommand implements Command {
	readonly label = "Move";
	constructor(
		private readonly id: string,
		private readonly dx: number,
		private readonly dy: number
	) {}
	do(doc: DxfDocument): void {
		doc.move(this.id, this.dx, this.dy);
	}
	undo(doc: DxfDocument): void {
		doc.move(this.id, -this.dx, -this.dy);
	}
}

export class MoveVertexCommand implements Command {
	readonly label = "Move vertex";
	constructor(
		private readonly id: string,
		private readonly pairIndex: number,
		private readonly dx: number,
		private readonly dy: number
	) {}
	do(doc: DxfDocument): void {
		doc.moveVertex(this.id, this.pairIndex, this.dx, this.dy);
	}
	undo(doc: DxfDocument): void {
		doc.moveVertex(this.id, this.pairIndex, -this.dx, -this.dy);
	}
}

export class DeleteCommand implements Command {
	readonly label = "Delete";
	constructor(private readonly id: string) {}
	do(doc: DxfDocument): void {
		doc.remove(this.id);
	}
	undo(doc: DxfDocument): void {
		doc.restore(this.id);
	}
}

export class ChangeLayerCommand implements Command {
	readonly label = "Change layer";
	private prev = "0";
	constructor(private readonly id: string, private readonly layer: string) {}
	do(doc: DxfDocument): void {
		this.prev = doc.layerOf(this.id);
		doc.setLayer(this.id, this.layer);
	}
	undo(doc: DxfDocument): void {
		doc.setLayer(this.id, this.prev);
	}
}

export class AddEntityCommand implements Command {
	readonly label = "Draw";
	private handle: string | null = null;
	constructor(private readonly spec: NewEntitySpec) {}
	do(doc: DxfDocument): void {
		// reuse the same handle across redo so undo/redo is stable
		this.handle = doc.addEntity(this.spec, this.handle ?? undefined);
	}
	undo(doc: DxfDocument): void {
		if (this.handle) doc.removeAdded(this.handle);
	}
	get createdHandle(): string | null {
		return this.handle;
	}
}

export class ChangeColorCommand implements Command {
	readonly label = "Change color";
	private prev: number | null = null;
	constructor(private readonly id: string, private readonly color: number | null) {}
	do(doc: DxfDocument): void {
		this.prev = doc.colorOf(this.id);
		doc.setColor(this.id, this.color);
	}
	undo(doc: DxfDocument): void {
		doc.setColor(this.id, this.prev);
	}
}

/** Set precise scalar properties (radius, text height/rotation/content, arc angles). */
export class SetPropsCommand implements Command {
	readonly label = "Edit properties";
	private prev: PropPatch = {};
	constructor(private readonly id: string, private readonly patch: PropPatch) {}
	do(doc: DxfDocument): void {
		const all = doc.propsOf(this.id);
		this.prev = {};
		for (const k of Object.keys(this.patch) as (keyof PropPatch)[]) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(this.prev as any)[k] = all[k];
		}
		doc.setProps(this.id, this.patch);
	}
	undo(doc: DxfDocument): void {
		doc.setProps(this.id, this.prev);
	}
}

/** Move an entity so its anchor lands exactly at a target point (precise placement). */
export class SetAnchorCommand implements Command {
	readonly label = "Set position";
	private prev: Point2 | null = null;
	constructor(private readonly id: string, private readonly x: number, private readonly y: number) {}
	do(doc: DxfDocument): void {
		this.prev = doc.anchorOf(this.id);
		doc.setAnchor(this.id, this.x, this.y);
	}
	undo(doc: DxfDocument): void {
		if (this.prev) doc.setAnchor(this.id, this.prev.x, this.prev.y);
	}
}

/** Rotate one or more entities about a shared pivot. */
export class RotateCommand implements Command {
	readonly label = "Rotate";
	constructor(
		private readonly ids: string[],
		private readonly cx: number,
		private readonly cy: number,
		private readonly deg: number
	) {}
	do(doc: DxfDocument): void {
		for (const id of this.ids) doc.rotate(id, this.cx, this.cy, this.deg);
	}
	undo(doc: DxfDocument): void {
		for (const id of this.ids) doc.rotate(id, this.cx, this.cy, -this.deg);
	}
}

export class AddLayerCommand implements Command {
	readonly label = "Add layer";
	constructor(private readonly name: string, private readonly patch: LayerPatch = {}) {}
	do(doc: DxfDocument): void {
		doc.addLayer(this.name, this.patch);
	}
	undo(doc: DxfDocument): void {
		doc.removeAddedLayer(this.name);
	}
}

export class UpdateLayerCommand implements Command {
	readonly label = "Edit layer";
	private prev: LayerPatch = {};
	constructor(private readonly name: string, private readonly patch: LayerPatch) {}
	do(doc: DxfDocument): void {
		const all = doc.layerState(this.name);
		this.prev = {};
		for (const k of Object.keys(this.patch) as (keyof LayerPatch)[]) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(this.prev as any)[k] = all[k];
		}
		doc.updateLayer(this.name, this.patch);
	}
	undo(doc: DxfDocument): void {
		doc.updateLayer(this.name, this.prev);
	}
}
