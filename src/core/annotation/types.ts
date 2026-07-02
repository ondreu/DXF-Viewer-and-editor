import type { Point2 } from "../model/types";

export interface DistanceMeasure {
	kind: "distance";
	length: number;
	dx: number;
	dy: number;
	angleDeg: number;
}
export interface RadiusMeasure {
	kind: "radius";
	radius: number;
	diameter: number;
	circumference: number;
}
export interface AngleMeasure {
	kind: "angle";
	angleDeg: number;
}
export type MeasureData = DistanceMeasure | RadiusMeasure | AngleMeasure;

/** Markup that lives *outside* the DXF, in a sidecar JSON (design doc / #4). */
export type Annotation =
	| { id: string; kind: "note"; at: Point2; text: string; color?: number }
	| { id: string; kind: "arrow"; from: Point2; to: Point2; text?: string; color?: number }
	| { id: string; kind: "rect"; min: Point2; max: Point2; text?: string; color?: number }
	| { id: string; kind: "measure"; points: Point2[]; data: MeasureData; color?: number };

export interface AnnotationFile {
	version: 1;
	/** the drawing this markup belongs to, for sanity/debugging */
	drawing?: string;
	annotations: Annotation[];
}
