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
	| "draw-polyline"
	| "draw-text"
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
	setOverlay(prims: Overlay): void;
	/** publish a live/final measurement to the UI (null clears) */
	reportMeasurement(m: Measurement | null): void;
	addAnnotation(a: Annotation): void;
	promptText(initial: string): Promise<string | null>;
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
	pointer(phase: "down" | "move" | "up" | "click", world: Point2, ev: PointerEvent): void;
	/** return true if the key was handled */
	key?(ev: KeyboardEvent): boolean;
	/** short hint shown in the UI */
	hint(): string;
}
