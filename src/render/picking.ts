import type { RenderEntity, Point2 } from "../core/model/types";

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
