import type { DxfDocument } from "../model/DxfDocument";

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
