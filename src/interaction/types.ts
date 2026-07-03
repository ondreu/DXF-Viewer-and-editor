import type { DxfDocument } from "../core/model/DxfDocument";
import type { Command } from "../core/command/commands";
import type { Point2 } from "../core/model/types";
import type { Overlay } from "../render/overlay";
import type { SnapResult } from "./snap";

export type ToolId =
	| "select"
	| "select-similar"
	| "measure-distance"
	| "measure-radius"
	| "measure-angle"
	| "measure-area"
	| "measure-area-polygon"
	| "measure-point"
	| "draw-line"
	| "draw-circle"
	| "draw-circle-2p"
	| "draw-circle-3p"
	| "draw-arc"
	| "draw-arc-3p"
	| "draw-ellipse"
	| "draw-xline"
	| "draw-ray"
	| "draw-polyline"
	| "draw-rectangle"
	| "draw-polygon"
	| "draw-text"
	| "rotate"
	| "scale"
	| "mirror"
	| "copy"
	| "fillet"
	| "chamfer"
	| "trim"
	| "extend"
	| "offset"
	| "array-rect"
	| "array-polar"
	| "match-props"
	| "join"
	| "break"
	| "explode"
	| "dimension-linear"
	| "hatch-solid"
	| "hatch-lines";

export type Measurement =
	| { kind: "distance"; length: number; dx: number; dy: number; angleDeg: number }
	| { kind: "radius"; radius: number; diameter: number; circumference: number }
	| { kind: "angle"; angleDeg: number }
	| { kind: "area"; area: number; perimeter: number }
	| { kind: "point"; x: number; y: number };

/** Everything a tool needs, so tools never touch three.js or Obsidian directly. */
export interface ToolContext {
	doc(): DxfDocument | null;
	/** snap a raw world point using current OSNAP settings; null = no snap */
	snap(world: Point2): SnapResult | null;
	/** true when ortho (hard-lock to 0/90/180/270°) is toggled on for drawing */
	orthoEnabled(): boolean;
	/** pick the nearest entity id at a world point */
	pick(world: Point2): string | null;
	execute(cmd: Command): void;
	select(id: string | null): void;
	/** replace the whole selection set at once (e.g. "select similar") */
	selectMany(ids: string[]): void;
	/** ctrl/cmd+click: add or remove an entity from the selection set */
	toggleSelection(id: string | null): void;
	/** currently selected entity handle, if any (for grip editing) */
	selectedId(): string | null;
	/** all selected entity handles (for group move / rotate) */
	selectedIds(): string[];
	setOverlay(prims: Overlay): void;
	/** publish a live/final measurement to the UI (null clears) */
	reportMeasurement(m: Measurement | null): void;
	promptText(initial: string, title?: string): Promise<string | null>;
	activeLayer(): string;
	/** active ACI colour, or null for BYLAYER */
	activeColor(): number | null;
	/** current world units per screen pixel (for sizing new text, snap tol) */
	pixelSize(): number;
	accent: number;
	/** notify that the tool changed transient state (for UI hints) */
	touch(): void;
}

export interface Tool {
	readonly id: ToolId;
	/** left-drag pans the view while this tool is active (true for Select) */
	readonly panWithLeftDrag: boolean;
	activate?(): void;
	deactivate?(): void;
	/** return true on a "down" press the tool consumes (e.g. grabbed a grip).
	 * "cancel" fires when the browser aborts the gesture (pointercancel) instead
	 * of a normal "up" — tools with multi-event drag state should drop it. */
	pointer(phase: "down" | "move" | "up" | "click" | "cancel", world: Point2, ev: PointerEvent): boolean | void;
	/** return true if the key was handled */
	key?(ev: KeyboardEvent): boolean;
	/** short hint shown in the UI */
	hint(): string;
}
