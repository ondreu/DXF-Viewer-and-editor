import type { RenderEntity, Point2 } from "../core/model/types";
import { ellipsePoints } from "../core/geom/geometry2d";

function distToSegment(p: Point2, a: Point2, b: Point2): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** World-space distance from a point to an entity's geometry. */
export function distanceToEntity(p: Point2, e: RenderEntity): number {
	switch (e.type) {
		case "LINE":
			return distToSegment(p, e.start, e.end);
		case "CIRCLE":
			return Math.abs(Math.hypot(p.x - e.center.x, p.y - e.center.y) - e.radius);
		case "ARC": {
			const d = Math.abs(Math.hypot(p.x - e.center.x, p.y - e.center.y) - e.radius);
			return d;
		}
		case "ELLIPSE": {
			const pts = ellipsePoints(e.center, e.majorAxisEndpoint, e.ratio, e.startAngle, e.endAngle, 48);
			let min = Infinity;
			for (let i = 0; i < pts.length - 1; i++) min = Math.min(min, distToSegment(p, pts[i], pts[i + 1]));
			return min;
		}
		case "LWPOLYLINE":
		case "POLYLINE": {
			let min = Infinity;
			const v = e.vertices;
			for (let i = 0; i < v.length - 1; i++) min = Math.min(min, distToSegment(p, v[i], v[i + 1]));
			if (e.closed && v.length > 2) min = Math.min(min, distToSegment(p, v[v.length - 1], v[0]));
			return min;
		}
		case "TEXT":
		case "MTEXT": {
			// crude bounding box around the insertion point
			const h = e.height || 1;
			const w = Math.max(h, e.text.length * h * 0.6);
			const dx = Math.max(0, Math.abs(p.x - (e.position.x + w / 2)) - w / 2);
			const dy = Math.max(0, Math.abs(p.y - (e.position.y + h / 2)) - h / 2);
			return Math.hypot(dx, dy);
		}
		case "INSERT": {
			let min = Infinity;
			for (const [a, b] of e.segments) min = Math.min(min, distToSegment(p, a, b));
			// also allow picking the insertion point itself
			return Math.min(min, Math.hypot(p.x - e.position.x, p.y - e.position.y));
		}
		case "UNSUPPORTED":
			return e.position ? Math.hypot(p.x - e.position.x, p.y - e.position.y) : Infinity;
	}
}

/** Pick the nearest entity within `threshold` world units, or null. */
export function pickEntity(
	p: Point2,
	entities: RenderEntity[],
	threshold: number,
	isHidden: (id: string) => boolean
): string | null {
	let best: string | null = null;
	let bestDist = threshold;
	for (const e of entities) {
		if (isHidden(e.id)) continue;
		const d = distanceToEntity(p, e);
		if (d <= bestDist) {
			bestDist = d;
			best = e.id;
		}
	}
	return best;
}

export interface Rect {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

function pointInRect(p: Point2, r: Rect): boolean {
	return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
	const cross = (o: Point2, p: Point2, q: Point2) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
	const d1 = cross(c, d, a);
	const d2 = cross(c, d, b);
	const d3 = cross(a, b, c);
	const d4 = cross(a, b, d);
	if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
	return false;
}

function segmentIntersectsRect(a: Point2, b: Point2, r: Rect): boolean {
	if (pointInRect(a, r) || pointInRect(b, r)) return true;
	const corners: Point2[] = [
		{ x: r.minX, y: r.minY },
		{ x: r.maxX, y: r.minY },
		{ x: r.maxX, y: r.maxY },
		{ x: r.minX, y: r.maxY },
	];
	for (let i = 0; i < 4; i++) {
		if (segmentsIntersect(a, b, corners[i], corners[(i + 1) % 4])) return true;
	}
	return false;
}

/** One or more open point chains approximating an entity's outline, for rubber-band hit testing. */
function outlineChains(e: RenderEntity): Point2[][] | null {
	switch (e.type) {
		case "LINE":
			return [[e.start, e.end]];
		case "LWPOLYLINE":
		case "POLYLINE":
			return [e.closed && e.vertices.length > 2 ? [...e.vertices, e.vertices[0]] : e.vertices];
		case "CIRCLE": {
			const pts: Point2[] = [];
			for (let i = 0; i <= 32; i++) {
				const a = (i / 32) * Math.PI * 2;
				pts.push({ x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) });
			}
			return [pts];
		}
		case "ARC": {
			const start = (e.startAngle * Math.PI) / 180;
			let sweep = ((e.endAngle - e.startAngle) * Math.PI) / 180;
			if (sweep <= 0) sweep += Math.PI * 2;
			const pts: Point2[] = [];
			for (let i = 0; i <= 32; i++) {
				const a = start + (sweep * i) / 32;
				pts.push({ x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) });
			}
			return [pts];
		}
		case "ELLIPSE":
			return [ellipsePoints(e.center, e.majorAxisEndpoint, e.ratio, e.startAngle, e.endAngle, 32)];
		case "TEXT":
		case "MTEXT": {
			const h = e.height || 1;
			const w = Math.max(h, e.text.length * h * 0.6);
			const p = e.position;
			return [[p, { x: p.x + w, y: p.y }, { x: p.x + w, y: p.y + h }, { x: p.x, y: p.y + h }, p]];
		}
		case "INSERT":
			return e.segments.length ? e.segments.map(([a, b]) => [a, b]) : [[e.position, e.position]];
		case "UNSUPPORTED":
			return e.position ? [[e.position, e.position]] : null;
	}
}

/**
 * Entities caught by a rubber-band drag. "window" (left-to-right drag) only
 * matches entities fully enclosed by the box; "crossing" (right-to-left drag)
 * matches anything the box touches — the standard CAD convention.
 */
export function entitiesInRect(
	entities: RenderEntity[],
	rect: Rect,
	mode: "window" | "crossing",
	isHidden: (id: string) => boolean
): string[] {
	const out: string[] = [];
	for (const e of entities) {
		if (isHidden(e.id)) continue;
		const chains = outlineChains(e);
		if (!chains || !chains.length) continue;
		if (mode === "window") {
			if (chains.every((chain) => chain.every((p) => pointInRect(p, rect)))) out.push(e.id);
			continue;
		}
		let hit = false;
		for (const chain of chains) {
			if (chain.some((p) => pointInRect(p, rect))) { hit = true; break; }
			for (let i = 0; i < chain.length - 1; i++) {
				if (segmentIntersectsRect(chain[i], chain[i + 1], rect)) { hit = true; break; }
			}
			if (hit) break;
		}
		if (hit) out.push(e.id);
	}
	return out;
}
