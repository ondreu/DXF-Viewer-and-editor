import type { DxfDocument } from "../core/model/DxfDocument";
import type { Command } from "../core/command/commands";
import type { Point2 } from "../core/model/types";
import type { Overlay } from "../render/overlay";
import type { SnapResult } from "./snap";
import type { Annotation } from "../core/annotation/types";

export type ToolId =
	| "select"
	| "measure-distance"
	| "measure-radius"
	| "measure-angle"
	| "draw-line"
	| "draw-circle"
	| "draw-circle-2p"
	| "draw-circle-3p"
	| "draw-arc"
	| "draw-arc-3p"
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
	| "annotate";

export type Measurement =
	| { kind: "distance"; length: number; dx: number; dy: number; angleDeg: number }
	| { kind: "radius"; radius: number; diameter: number; circumference: number }
	| { kind: "angle"; angleDeg: number };

/** Everything a tool needs, so tools never touch three.js or Obsidian directly. */
export interface ToolContext {
	doc(): DxfDocument | null;
	/** snap a raw world point using current OSNAP settings; null = no snap */
	snap(world: Point2): SnapResult | null;
	/** pick the nearest entity id at a world point */
	pick(world: Point2): string | null;
	execute(cmd: Command): void;
	select(id: string | null): void;
	/** ctrl/cmd+click: add or remove an entity from the selection set */
	toggleSelection(id: string | null): void;
	/** currently selected entity handle, if any (for grip editing) */
	selectedId(): string | null;
	/** all selected entity handles (for group move / rotate) */
	selectedIds(): string[];
	/** id of a note annotation near a world point, for dragging it */
	annotationAt(world: Point2): string | null;
	/** move a note annotation; `attachTo` pins it to an entity (or null to detach) */
	moveAnnotationTo(id: string, at: Point2, attachTo: string | null): void;
	setOverlay(prims: Overlay): void;
	/** publish a live/final measurement to the UI (null clears); points feed "save as annotation" */
	reportMeasurement(m: Measurement | null, points?: Point2[]): void;
	addAnnotation(a: Annotation): void;
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
	/** return true on a "down" press the tool consumes (e.g. grabbed a grip) */
	pointer(phase: "down" | "move" | "up" | "click", world: Point2, ev: PointerEvent): boolean | void;
	/** return true if the key was handled */
	key?(ev: KeyboardEvent): boolean;
	/** short hint shown in the UI */
	hint(): string;
}
