import type { Point2 } from "../core/model/types";

export type MarkerStyle = "square" | "x" | "diamond" | "triangle" | "circle" | "dot";

/**
 * Resolution-independent overlay primitives. Tools emit these (rubber-band
 * geometry, snap markers, dimension labels); the renderer rasterizes them at the
 * current zoom. Keeping tools in this abstract vocabulary means they never
 * import three.js and stay unit-testable.
 */
export type OverlayPrim =
	| { kind: "line"; pts: Point2[]; color?: number; dashed?: boolean; closed?: boolean }
	| { kind: "circle"; center: Point2; radius: number; color?: number; dashed?: boolean }
	| { kind: "marker"; at: Point2; style: MarkerStyle; color?: number; sizePx?: number }
	| { kind: "label"; at: Point2; text: string; color?: number; background?: number };

export type Overlay = OverlayPrim[];
