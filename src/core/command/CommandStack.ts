import type { DxfDocument } from "../model/DxfDocument";
import type { Command } from "./commands";
import { EventEmitter } from "../events/EventEmitter";

export type CommandStackEvents = {
	change: { canUndo: boolean; canRedo: boolean; dirty: boolean };
};

/**
 * Undo/redo as a stack of reversible commands (design doc §7). Deliberately a
 * self-contained scope so an embedded DXF view never fights Obsidian's own
 * editor undo (open question §11.3 — isolation is the chosen answer).
 */
export class CommandStack {
	readonly events = new EventEmitter<CommandStackEvents>();
	private undoStack: Command[] = [];
	private redoStack: Command[] = [];

	constructor(private readonly doc: DxfDocument) {}

	execute(cmd: Command): void {
		cmd.do(this.doc);
		this.undoStack.push(cmd);
		this.redoStack = [];
		this.notify();
	}

	undo(): void {
		const cmd = this.undoStack.pop();
		if (!cmd) return;
		cmd.undo(this.doc);
		this.redoStack.push(cmd);
		this.notify();
	}

	redo(): void {
		const cmd = this.redoStack.pop();
		if (!cmd) return;
		cmd.do(this.doc);
		this.undoStack.push(cmd);
		this.notify();
	}

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	/** Mark the current stack position as the last saved state. */
	markSaved(): void {
		this.savedDepth = this.undoStack.length;
		this.notify();
	}

	private savedDepth = 0;

	get dirty(): boolean {
		return this.undoStack.length !== this.savedDepth;
	}

	private notify(): void {
		this.events.emit("change", {
			canUndo: this.canUndo,
			canRedo: this.canRedo,
			dirty: this.dirty,
		});
	}
}
