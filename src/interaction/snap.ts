import type { RenderEntity, Point2 } from "../core/model/types";

export type SnapType =
	| "endpoint"
	| "midpoint"
	| "center"
	| "quadrant"
	| "intersection"
	| "node"
	| "extension"
	| "grid"
	| "nearest";

export interface SnapResult {
	point: Point2;
	type: SnapType;
	entityId?: string;
}

export interface SnapSettings {
	enabled: boolean;
	endpoint: boolean;
	midpoint: boolean;
	center: boolean;
	quadrant: boolean;
	intersection: boolean;
	/** snap to the infinite-line extension of a segment beyond its endpoints */
	extension: boolean;
	grid: boolean;
	gridSpacing: number;
}

export const DEFAULT_SNAP: SnapSettings = {
	enabled: true,
	endpoint: true,
	midpoint: true,
	center: true,
	quadrant: true,
	intersection: true,
	extension: true,
	grid: false,
	gridSpacing: 1,
};

// Priority: object snaps beat grid, and precise features beat "nearest".
const PRIORITY: Record<SnapType, number> = {
	endpoint: 0,
	intersection: 1,
	center: 2,
	midpoint: 3,
	quadrant: 4,
	node: 5,
	extension: 6,
	grid: 7,
	nearest: 8,
};

/** How far past a segment's end (in tol multiples) an extension snap still fires. */
const EXTENSION_REACH = 40;

function dist(a: Point2, b: Point2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Endpoints/vertices an entity contributes. */
function endpointsOf(e: RenderEntity): Point2[] {
	switch (e.type) {
		case "LINE":
			return [e.start, e.end];
		case "LWPOLYLINE":
		case "POLYLINE":
			return e.vertices;
		case "ARC": {
			const s = (e.startAngle * Math.PI) / 180;
			const t = (e.endAngle * Math.PI) / 180;
			return [
				{ x: e.center.x + e.radius * Math.cos(s), y: e.center.y + e.radius * Math.sin(s) },
				{ x: e.center.x + e.radius * Math.cos(t), y: e.center.y + e.radius * Math.sin(t) },
			];
		}
		default:
			return [];
	}
}

function midpointsOf(e: RenderEntity): Point2[] {
	const mid = (a: Point2, b: Point2): Point2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
	switch (e.type) {
		case "LINE":
			return [mid(e.start, e.end)];
		case "LWPOLYLINE":
		case "POLYLINE": {
			const out: Point2[] = [];
			for (let i = 0; i < e.vertices.length - 1; i++) out.push(mid(e.vertices[i], e.vertices[i + 1]));
			if (e.closed && e.vertices.length > 2) out.push(mid(e.vertices[e.vertices.length - 1], e.vertices[0]));
			return out;
		}
		default:
			return [];
	}
}

function centerOf(e: RenderEntity): Point2 | null {
	return e.type === "CIRCLE" || e.type === "ARC" ? e.center : null;
}

function quadrantsOf(e: RenderEntity): Point2[] {
	if (e.type !== "CIRCLE" && e.type !== "ARC") return [];
	const r = e.radius;
	const c = e.center;
	return [
		{ x: c.x + r, y: c.y },
		{ x: c.x, y: c.y + r },
		{ x: c.x - r, y: c.y },
		{ x: c.x, y: c.y - r },
	];
}

/** Project a point onto the infinite line through a,b; returns foot, param t, length. */
function projectOnLine(p: Point2, a: Point2, b: Point2): { point: Point2; t: number; len: number } | null {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	if (len2 < 1e-18) return null;
	const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
	return { point: { x: a.x + t * dx, y: a.y + t * dy }, t, len: Math.sqrt(len2) };
}

/** Infinite-line intersection of two segments' host lines (used for OSNAP). */
function lineIntersection(a1: Point2, a2: Point2, b1: Point2, b2: Point2): Point2 | null {
	const d1x = a2.x - a1.x;
	const d1y = a2.y - a1.y;
	const d2x = b2.x - b1.x;
	const d2y = b2.y - b1.y;
	const denom = d1x * d2y - d1y * d2x;
	if (Math.abs(denom) < 1e-12) return null;
	const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
	return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

function segmentsOf(e: RenderEntity): Array<[Point2, Point2]> {
	switch (e.type) {
		case "LINE":
			return [[e.start, e.end]];
		case "LWPOLYLINE":
		case "POLYLINE": {
			const out: Array<[Point2, Point2]> = [];
			for (let i = 0; i < e.vertices.length - 1; i++) out.push([e.vertices[i], e.vertices[i + 1]]);
			if (e.closed && e.vertices.length > 2) out.push([e.vertices[e.vertices.length - 1], e.vertices[0]]);
			return out;
		}
		default:
			return [];
	}
}

/**
 * Compute the best snap for a cursor position. `tol` is the pick tolerance in
 * world units (caller converts from pixels). Returns null when nothing is in
 * range (and grid is off). Used by both the measure and draw tools.
 */
export function computeSnap(
	cursor: Point2,
	entities: RenderEntity[],
	settings: SnapSettings,
	tol: number,
	isHidden: (id: string) => boolean = () => false
): SnapResult | null {
	if (!settings.enabled) {
		return settings.grid ? gridSnap(cursor, settings.gridSpacing) : null;
	}

	let best: SnapResult | null = null;
	const consider = (point: Point2, type: SnapType, entityId?: string) => {
		if (dist(cursor, point) > tol) return;
		if (!best || PRIORITY[type] < PRIORITY[best.type]) best = { point, type, entityId };
	};

	// Limit candidates to entities whose points are near the cursor.
	const near: RenderEntity[] = [];
	for (const e of entities) {
		if (isHidden(e.id)) continue;
		if (settings.endpoint) for (const p of endpointsOf(e)) consider(p, "endpoint", e.id);
		if (settings.midpoint) for (const p of midpointsOf(e)) consider(p, "midpoint", e.id);
		if (settings.center) {
			const c = centerOf(e);
			if (c) consider(c, "center", e.id);
		}
		if (settings.quadrant) for (const p of quadrantsOf(e)) consider(p, "quadrant", e.id);
		if ((settings.intersection || settings.extension) && segmentsOf(e).length) near.push(e);

		// Extension: project the cursor onto each segment's infinite line; snap to
		// the foot when it lies *beyond* the segment (a construction extension).
		if (settings.extension) {
			for (const [a, b] of segmentsOf(e)) {
				const foot = projectOnLine(cursor, a, b);
				if (!foot) continue;
				if (foot.t >= -1e-9 && foot.t <= 1 + 1e-9) continue; // on the segment (nearest, not extension)
				const along = foot.t < 0 ? -foot.t : foot.t - 1;
				if (along * foot.len > EXTENSION_REACH * tol) continue;
				consider(foot.point, "extension", e.id);
			}
		}
	}

	if (settings.intersection) {
		for (let i = 0; i < near.length; i++) {
			for (const sa of segmentsOf(near[i])) {
				for (let j = i + 1; j < near.length; j++) {
					for (const sb of segmentsOf(near[j])) {
						const p = lineIntersection(sa[0], sa[1], sb[0], sb[1]);
						if (p) consider(p, "intersection");
					}
				}
			}
		}
	}

	if (!best && settings.grid) return gridSnap(cursor, settings.gridSpacing);
	return best;
}

export function gridSnap(cursor: Point2, spacing: number): SnapResult {
	if (spacing <= 0) return { point: cursor, type: "grid" };
	return {
		point: {
			x: Math.round(cursor.x / spacing) * spacing,
			y: Math.round(cursor.y / spacing) * spacing,
		},
		type: "grid",
	};
}
