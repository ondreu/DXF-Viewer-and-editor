import type { DxfDocument, PropPatch, LayerPatch } from "../model/DxfDocument";
import type { NewEntitySpec, Point2, RenderEntity } from "../model/types";

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

/** Type-safe snapshot of a subset of a record's keys (used to capture undo state). */
function pick<T extends object, K extends keyof T>(src: T, keys: K[]): Pick<T, K> {
	const out = {} as Pick<T, K>;
	for (const k of keys) out[k] = src[k];
	return out;
}

/** Groups several commands into one undo/redo step (fillet, chamfer, array, ...). */
export class BatchCommand implements Command {
	constructor(private readonly commands: Command[], readonly label = "Edit") {}
	do(doc: DxfDocument): void {
		for (const c of this.commands) c.do(doc);
	}
	undo(doc: DxfDocument): void {
		for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].undo(doc);
	}
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
		this.prev = pick(all, Object.keys(this.patch) as (keyof PropPatch)[]);
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

/** Scale one or more entities by a common factor about a shared pivot. */
export class ScaleCommand implements Command {
	readonly label = "Scale";
	constructor(
		private readonly ids: string[],
		private readonly cx: number,
		private readonly cy: number,
		private readonly factor: number
	) {}
	do(doc: DxfDocument): void {
		for (const id of this.ids) doc.scale(id, this.cx, this.cy, this.factor);
	}
	undo(doc: DxfDocument): void {
		for (const id of this.ids) doc.scale(id, this.cx, this.cy, 1 / this.factor);
	}
}

/** Mirror one or more entities across a shared line; mirroring twice is exact undo. */
export class MirrorCommand implements Command {
	readonly label = "Mirror";
	constructor(
		private readonly ids: string[],
		private readonly ax: number,
		private readonly ay: number,
		private readonly bx: number,
		private readonly by: number
	) {}
	do(doc: DxfDocument): void {
		for (const id of this.ids) doc.mirror(id, this.ax, this.ay, this.bx, this.by);
	}
	undo(doc: DxfDocument): void {
		for (const id of this.ids) doc.mirror(id, this.ax, this.ay, this.bx, this.by);
	}
}

/** Build a draw spec that duplicates `e`'s geometry offset by (dx, dy). */
export function specFromEntity(e: RenderEntity, dx: number, dy: number): NewEntitySpec | null {
	const shift = (p: Point2): Point2 => ({ x: p.x + dx, y: p.y + dy });
	switch (e.type) {
		case "LINE":
			return { type: "LINE", layer: e.layer, colorNumber: e.colorNumber, start: shift(e.start), end: shift(e.end) };
		case "CIRCLE":
			return { type: "CIRCLE", layer: e.layer, colorNumber: e.colorNumber, center: shift(e.center), radius: e.radius };
		case "ARC":
			return { type: "ARC", layer: e.layer, colorNumber: e.colorNumber, center: shift(e.center), radius: e.radius, startAngle: e.startAngle, endAngle: e.endAngle };
		case "LWPOLYLINE":
			return { type: "LWPOLYLINE", layer: e.layer, colorNumber: e.colorNumber, vertices: e.vertices.map(shift), closed: e.closed };
		case "TEXT":
			return { type: "TEXT", layer: e.layer, colorNumber: e.colorNumber, position: shift(e.position), height: e.height, rotation: e.rotation, text: e.text };
		default:
			return null;
	}
}

/** Duplicate one or more entities offset by (dx, dy) — the same handles redo onto. */
export class CopyCommand implements Command {
	readonly label = "Copy";
	private handles: (string | null)[] = [];
	constructor(private readonly ids: string[], private readonly dx: number, private readonly dy: number) {}
	do(doc: DxfDocument): void {
		this.handles = this.ids.map((id, i) => {
			const e = doc.getEntity(id);
			const spec = e ? specFromEntity(e, this.dx, this.dy) : null;
			if (!spec) return null;
			return doc.addEntity(spec, this.handles[i] ?? undefined);
		});
	}
	undo(doc: DxfDocument): void {
		for (const h of this.handles) if (h) doc.removeAdded(h);
	}
	get createdHandles(): string[] {
		return this.handles.filter((h): h is string => !!h);
	}
}

/** Duplicate one or more entities, rotating each new copy by `angleDeg` about a pivot (polar array). */
export class PolarCopyCommand implements Command {
	readonly label = "Array (polar)";
	private handles: (string | null)[] = [];
	constructor(
		private readonly ids: string[],
		private readonly cx: number,
		private readonly cy: number,
		private readonly angleDeg: number
	) {}
	do(doc: DxfDocument): void {
		this.handles = this.ids.map((id, i) => {
			const e = doc.getEntity(id);
			const spec = e ? specFromEntity(e, 0, 0) : null;
			if (!spec) return null;
			const h = doc.addEntity(spec, this.handles[i] ?? undefined);
			doc.rotate(h, this.cx, this.cy, this.angleDeg);
			return h;
		});
	}
	undo(doc: DxfDocument): void {
		for (const h of this.handles) if (h) doc.removeAdded(h);
	}
	get createdHandles(): string[] {
		return this.handles.filter((h): h is string => !!h);
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
		this.prev = pick(all, Object.keys(this.patch) as (keyof LayerPatch)[]);
		doc.updateLayer(this.name, this.patch);
	}
	undo(doc: DxfDocument): void {
		doc.updateLayer(this.name, this.prev);
	}
}
