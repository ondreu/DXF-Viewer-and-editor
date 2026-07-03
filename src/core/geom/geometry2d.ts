import type { Point2, RenderEntity, LineEntity } from "../model/types";

/** Pure 2D geometry helpers shared by the construction/edit tools (circle/arc
 * variants, fillet, chamfer, trim, extend). Kept separate from tools.ts so the
 * math can be unit-tested without mocking the interaction layer. */

export function norm360(deg: number): number {
	return ((deg % 360) + 360) % 360;
}

/** True if angle `a` (deg) lies on the CCW sweep from `start` to `end` (deg). */
export function angleInArc(a: number, start: number, end: number): boolean {
	const sweep = norm360(end - start) || 360;
	const rel = norm360(a - start);
	return rel <= sweep + 1e-6;
}

/** Perimeter/arc-length of a single entity (0 for point-like or unsupported types). */
export function entityLength(e: RenderEntity): number {
	switch (e.type) {
		case "LINE":
			return dist(e.start, e.end);
		case "CIRCLE":
			return 2 * Math.PI * e.radius;
		case "ARC":
			return e.radius * ((norm360(e.endAngle - e.startAngle) || 360) * Math.PI) / 180;
		case "LWPOLYLINE":
		case "POLYLINE": {
			let total = 0;
			for (let i = 0; i < e.vertices.length - 1; i++) total += dist(e.vertices[i], e.vertices[i + 1]);
			if (e.closed && e.vertices.length > 2) total += dist(e.vertices[e.vertices.length - 1], e.vertices[0]);
			return total;
		}
		case "HATCH": {
			let total = 0;
			const v = e.vertices;
			for (let i = 0; i < v.length; i++) total += dist(v[i], v[(i + 1) % v.length]);
			return total;
		}
		case "ELLIPSE": {
			const pts = ellipsePoints(e.center, e.majorAxisEndpoint, e.ratio, e.startAngle, e.endAngle);
			let total = 0;
			for (let i = 0; i < pts.length - 1; i++) total += dist(pts[i], pts[i + 1]);
			return total;
		}
		default:
			return 0;
	}
}

/** Area + perimeter of a closed shape (CIRCLE, full ELLIPSE, or closed LWPOLYLINE/POLYLINE), or null if `e` isn't closed. */
export function entityArea(e: RenderEntity): { area: number; perimeter: number } | null {
	if (e.type === "CIRCLE") return { area: Math.PI * e.radius * e.radius, perimeter: entityLength(e) };
	if (e.type === "ELLIPSE" && isFullEllipseSweep(e.startAngle, e.endAngle)) {
		const major = dist(e.center, e.majorAxisEndpoint);
		const minor = major * e.ratio;
		return { area: Math.PI * major * minor, perimeter: entityLength(e) };
	}
	if (((e.type === "LWPOLYLINE" || e.type === "POLYLINE") && e.closed && e.vertices.length >= 3) || (e.type === "HATCH" && e.vertices.length >= 3)) {
		const v = e.vertices;
		let twiceArea = 0;
		for (let i = 0; i < v.length; i++) {
			const a = v[i], b = v[(i + 1) % v.length];
			twiceArea += a.x * b.y - b.x * a.y;
		}
		return { area: Math.abs(twiceArea) / 2, perimeter: entityLength(e) };
	}
	return null;
}

/**
 * Constrain `to` to the nearest multiple of `incrementDeg` (default 90° — the
 * classic CAD "ortho" 0/90/180/270 directions) measured from `from`, keeping
 * the same distance. If `thresholdDeg` is given, the constraint only kicks in
 * when the raw angle is already within that many degrees of a multiple —
 * a soft "angle assist" that snaps a nearly-straight line without forcing
 * every line to be axis-aligned; omit it for a hard/always-on lock.
 */
export function applyOrtho(from: Point2, to: Point2, incrementDeg = 90, thresholdDeg?: number): Point2 {
	const dx = to.x - from.x, dy = to.y - from.y;
	const d = Math.hypot(dx, dy);
	if (d < 1e-9) return to;
	const rawDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
	const nearestDeg = Math.round(rawDeg / incrementDeg) * incrementDeg;
	if (thresholdDeg !== undefined && Math.abs(norm180(rawDeg - nearestDeg)) > thresholdDeg) return to;
	const rad = (nearestDeg * Math.PI) / 180;
	return { x: from.x + d * Math.cos(rad), y: from.y + d * Math.sin(rad) };
}

function norm180(deg: number): number {
	const d = norm360(deg + 180) - 180;
	return d;
}

/** True when a start/end sweep (deg) describes a full ellipse rather than a partial arc. */
export function isFullEllipseSweep(startDeg: number, endDeg: number): boolean {
	return Math.abs(norm360(endDeg - startDeg)) < 1e-6;
}

/** Sample points along an ellipse (or elliptical arc) for rendering, picking and preview overlays. */
export function ellipsePoints(center: Point2, majorAxisEndpoint: Point2, ratio: number, startDeg: number, endDeg: number, steps = 64): Point2[] {
	const mx = majorAxisEndpoint.x - center.x, my = majorAxisEndpoint.y - center.y;
	const full = isFullEllipseSweep(startDeg, endDeg);
	const start = (startDeg * Math.PI) / 180;
	let sweep = full ? Math.PI * 2 : ((endDeg - startDeg) * Math.PI) / 180;
	if (!full && sweep <= 0) sweep += Math.PI * 2;
	const pts: Point2[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = start + (sweep * i) / steps;
		const cos = Math.cos(t), sin = Math.sin(t);
		pts.push({ x: center.x + mx * cos - my * ratio * sin, y: center.y + my * cos + mx * ratio * sin });
	}
	return pts;
}

/**
 * Chain a set of LINE segments end-to-end into a single open/closed polyline
 * (for the Join tool). Segments may be given in any order and either
 * direction. Returns null unless *every* segment links into one connected
 * chain — a partial/branching join is left for the caller to reject rather
 * than silently dropping entities.
 */
export function joinLineChain(segments: Array<{ start: Point2; end: Point2 }>, tol: number): { vertices: Point2[]; closed: boolean } | null {
	if (segments.length < 2) return null;
	const remaining = segments.slice(1);
	let chain: Point2[] = [segments[0].start, segments[0].end];
	const close = (a: Point2, b: Point2) => dist(a, b) <= tol;
	let progress = true;
	while (remaining.length && progress) {
		progress = false;
		for (let i = 0; i < remaining.length; i++) {
			const s = remaining[i];
			const head = chain[0], tail = chain[chain.length - 1];
			if (close(tail, s.start)) { chain.push(s.end); remaining.splice(i, 1); progress = true; break; }
			if (close(tail, s.end)) { chain.push(s.start); remaining.splice(i, 1); progress = true; break; }
			if (close(head, s.end)) { chain.unshift(s.start); remaining.splice(i, 1); progress = true; break; }
			if (close(head, s.start)) { chain.unshift(s.end); remaining.splice(i, 1); progress = true; break; }
		}
	}
	if (remaining.length) return null;
	const closed = chain.length > 2 && close(chain[0], chain[chain.length - 1]);
	if (closed) chain = chain.slice(0, -1);
	return { vertices: chain, closed };
}

/** Circumcircle of three points, or null if they're (near-)collinear. */
export function circumcircle(a: Point2, b: Point2, c: Point2): { center: Point2; radius: number } | null {
	const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
	if (Math.abs(d) < 1e-9) return null;
	const a2 = a.x * a.x + a.y * a.y;
	const b2 = b.x * b.x + b.y * b.y;
	const c2 = c.x * c.x + c.y * c.y;
	const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
	const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
	const center = { x: ux, y: uy };
	return { center, radius: Math.hypot(a.x - ux, a.y - uy) };
}

/** Intersection of infinite line p1-p2 with infinite line p3-p4, or null if (near-)parallel. */
export function lineLineIntersect(p1: Point2, p2: Point2, p3: Point2, p4: Point2): Point2 | null {
	const rx = p2.x - p1.x, ry = p2.y - p1.y;
	const sx = p4.x - p3.x, sy = p4.y - p3.y;
	const denom = rx * sy - ry * sx;
	if (Math.abs(denom) < 1e-9) return null;
	const qpx = p3.x - p1.x, qpy = p3.y - p1.y;
	const t = (qpx * sy - qpy * sx) / denom;
	return { x: p1.x + t * rx, y: p1.y + t * ry };
}

/** Where the infinite line through a,b crosses finite segment p-q (bounded on p-q); `t` is the param along a->b. */
export function lineSegmentHits(a: Point2, b: Point2, p: Point2, q: Point2): { point: Point2; t: number }[] {
	const rx = b.x - a.x, ry = b.y - a.y;
	const sx = q.x - p.x, sy = q.y - p.y;
	const denom = rx * sy - ry * sx;
	if (Math.abs(denom) < 1e-9) return [];
	const qpx = p.x - a.x, qpy = p.y - a.y;
	const t = (qpx * sy - qpy * sx) / denom;
	const u = (qpx * ry - qpy * rx) / denom;
	if (u < -1e-6 || u > 1 + 1e-6) return [];
	return [{ point: { x: a.x + t * rx, y: a.y + t * ry }, t }];
}

/** Where the infinite line through a,b crosses circle (center,radius); `t` is the param along a->b. */
export function lineCircleHits(a: Point2, b: Point2, center: Point2, radius: number): { point: Point2; t: number }[] {
	const dx = b.x - a.x, dy = b.y - a.y;
	const A = dx * dx + dy * dy;
	if (A < 1e-12) return [];
	const fx = a.x - center.x, fy = a.y - center.y;
	const B = 2 * (fx * dx + fy * dy);
	const C = fx * fx + fy * fy - radius * radius;
	const disc = B * B - 4 * A * C;
	if (disc < 0) return [];
	const sq = Math.sqrt(Math.max(disc, 0));
	const t1 = (-B - sq) / (2 * A);
	const t2 = (-B + sq) / (2 * A);
	const mk = (t: number) => ({ point: { x: a.x + t * dx, y: a.y + t * dy }, t });
	return Math.abs(t1 - t2) < 1e-9 ? [mk(t1)] : [mk(t1), mk(t2)];
}

/** Where finite segment p-q crosses circle (center,radius) (bounded on p-q). */
export function segmentCircleHits(p: Point2, q: Point2, center: Point2, radius: number): Point2[] {
	return lineCircleHits(p, q, center, radius)
		.filter(({ t }) => t >= -1e-6 && t <= 1 + 1e-6)
		.map((h) => h.point);
}

/** Intersection points of two circles (0, 1 or 2 points). */
export function circleCircleHits(c1: Point2, r1: number, c2: Point2, r2: number): Point2[] {
	const dx = c2.x - c1.x, dy = c2.y - c1.y;
	const d = Math.hypot(dx, dy);
	if (d < 1e-9 || d > r1 + r2 + 1e-6 || d < Math.abs(r1 - r2) - 1e-6) return [];
	const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
	const h = Math.sqrt(Math.max(r1 * r1 - a * a, 0));
	const mx = c1.x + (a * dx) / d, my = c1.y + (a * dy) / d;
	const ox = (-dy * h) / d, oy = (dx * h) / d;
	if (h < 1e-9) return [{ x: mx, y: my }];
	return [{ x: mx + ox, y: my + oy }, { x: mx - ox, y: my - oy }];
}

function edgeSegments(vertices: Point2[], closed: boolean): Array<[Point2, Point2]> {
	const out: Array<[Point2, Point2]> = [];
	for (let i = 0; i < vertices.length - 1; i++) out.push([vertices[i], vertices[i + 1]]);
	if (closed && vertices.length > 2) out.push([vertices[vertices.length - 1], vertices[0]]);
	return out;
}

function dist(a: Point2, b: Point2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDeg(c: Point2, p: Point2): number {
	return norm360((Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI);
}

/** The endpoint of `line` nearest `click`, and which pair-index (0=start, 1=end) it is. */
function nearEndpoint(line: LineEntity, click: Point2): { pt: Point2; pair: 0 | 1 } {
	return dist(line.start, click) <= dist(line.end, click) ? { pt: line.start, pair: 0 } : { pt: line.end, pair: 1 };
}

interface CornerGeometry {
	intersection: Point2;
	pair1: 0 | 1; u1: Point2; farLen1: number;
	pair2: 0 | 1; u2: Point2; farLen2: number;
}

/**
 * Shared corner setup for fillet/chamfer: where the two (infinite) lines cross,
 * plus for each line the unit direction from that crossing *out towards its kept
 * ("far") endpoint*, and how far away that endpoint is.
 *
 * The tangent/chamfer point on each line is the crossing pulled back by some
 * distance along that same "towards far" direction (`I + dist * u`) — this is
 * what actually shortens each line from the corner, whether the corner is a
 * perfect flush join (near == intersection) or has a small gap/overlap.
 */
function cornerGeometry(line1: LineEntity, click1: Point2, line2: LineEntity, click2: Point2): CornerGeometry | null {
	const I = lineLineIntersect(line1.start, line1.end, line2.start, line2.end);
	if (!I) return null;
	const n1 = nearEndpoint(line1, click1);
	const far1 = n1.pair === 0 ? line1.end : line1.start;
	const n2 = nearEndpoint(line2, click2);
	const far2 = n2.pair === 0 ? line2.end : line2.start;
	const farLen1 = dist(far1, I), farLen2 = dist(far2, I);
	if (farLen1 < 1e-9 || farLen2 < 1e-9) return null;
	return {
		intersection: I,
		pair1: n1.pair, u1: { x: (far1.x - I.x) / farLen1, y: (far1.y - I.y) / farLen1 }, farLen1,
		pair2: n2.pair, u2: { x: (far2.x - I.x) / farLen2, y: (far2.y - I.y) / farLen2 }, farLen2,
	};
}

export interface CornerTrim {
	pair1: 0 | 1;
	point1: Point2;
	pair2: 0 | 1;
	point2: Point2;
}

export interface FilletResult extends CornerTrim {
	center: Point2;
	startAngle: number;
	endAngle: number;
}

/** Round a corner between two LINEs with a tangent ARC of `radius`, trimming both
 * lines to the tangent points. `click1`/`click2` pick which end of each line moves. */
export function computeFillet(line1: LineEntity, click1: Point2, line2: LineEntity, click2: Point2, radius: number): FilletResult | null {
	const corner = cornerGeometry(line1, click1, line2, click2);
	if (!corner) return null;
	const cos = corner.u1.x * corner.u2.x + corner.u1.y * corner.u2.y;
	const theta = Math.acos(Math.max(-1, Math.min(1, cos)));
	if (theta < 1e-6 || Math.PI - theta < 1e-6) return null; // parallel/opposite — no corner to round
	const half = theta / 2;
	const tanDist = radius / Math.tan(half);
	if (radius > 1e-9 && (tanDist > corner.farLen1 || tanDist > corner.farLen2)) return null; // radius too big for these segments
	const bx = corner.u1.x + corner.u2.x, by = corner.u1.y + corner.u2.y;
	const blen = Math.hypot(bx, by);
	if (blen < 1e-9) return null;
	const centerDist = radius / Math.sin(half);
	const center = { x: corner.intersection.x + (bx / blen) * centerDist, y: corner.intersection.y + (by / blen) * centerDist };
	const point1 = { x: corner.intersection.x + corner.u1.x * tanDist, y: corner.intersection.y + corner.u1.y * tanDist };
	const point2 = { x: corner.intersection.x + corner.u2.x * tanDist, y: corner.intersection.y + corner.u2.y * tanDist };
	const a1 = angleDeg(center, point1), a2 = angleDeg(center, point2);
	const sweepFwd = norm360(a2 - a1);
	const [startAngle, endAngle] = sweepFwd <= 180 ? [a1, a2] : [a2, a1];
	return { pair1: corner.pair1, point1, pair2: corner.pair2, point2, center, startAngle, endAngle };
}

/** Bevel a corner between two LINEs with a straight chamfer of equal `distance` on each side. */
export function computeChamfer(line1: LineEntity, click1: Point2, line2: LineEntity, click2: Point2, distance: number): CornerTrim | null {
	const corner = cornerGeometry(line1, click1, line2, click2);
	if (!corner) return null;
	if (distance > corner.farLen1 || distance > corner.farLen2) return null; // distance too big for these segments
	const point1 = { x: corner.intersection.x + corner.u1.x * distance, y: corner.intersection.y + corner.u1.y * distance };
	const point2 = { x: corner.intersection.x + corner.u2.x * distance, y: corner.intersection.y + corner.u2.y * distance };
	return { pair1: corner.pair1, point1, pair2: corner.pair2, point2 };
}

/** LINE, CIRCLE, ARC and LWPOLYLINE are the entity types trim/extend can use as a boundary. */
export function isCuttingEdgeType(e: RenderEntity): boolean {
	return e.type === "LINE" || e.type === "CIRCLE" || e.type === "ARC" || e.type === "LWPOLYLINE" || e.type === "POLYLINE";
}

/** Where the infinite line through a,b crosses cutting-edge entity `edge`, bounded to
 * the edge's own finite extent (segment / whole circle / arc angle range). `t` is the
 * param along a->b, so callers can tell "inside the current segment" from "beyond it". */
export function lineEdgeHits(a: Point2, b: Point2, edge: RenderEntity): { point: Point2; t: number }[] {
	switch (edge.type) {
		case "LINE":
			return lineSegmentHits(a, b, edge.start, edge.end);
		case "LWPOLYLINE":
		case "POLYLINE": {
			const out: { point: Point2; t: number }[] = [];
			for (const [p, q] of edgeSegments(edge.vertices, edge.closed)) out.push(...lineSegmentHits(a, b, p, q));
			return out;
		}
		case "CIRCLE":
			return lineCircleHits(a, b, edge.center, edge.radius);
		case "ARC":
			return lineCircleHits(a, b, edge.center, edge.radius).filter((h) =>
				angleInArc((Math.atan2(h.point.y - edge.center.y, h.point.x - edge.center.x) * 180) / Math.PI, edge.startAngle, edge.endAngle)
			);
		default:
			return [];
	}
}

/** Where circle (center,radius) crosses cutting-edge entity `edge`, bounded to the
 * edge's own finite extent. `angleDeg` is the hit's angle on the query circle. */
export function circleEdgeHits(center: Point2, radius: number, edge: RenderEntity): { point: Point2; angleDeg: number }[] {
	const withAngle = (pts: Point2[]) => pts.map((point) => ({ point, angleDeg: norm360((Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI) }));
	switch (edge.type) {
		case "LINE":
			return withAngle(segmentCircleHits(edge.start, edge.end, center, radius));
		case "LWPOLYLINE":
		case "POLYLINE": {
			const out: Point2[] = [];
			for (const [p, q] of edgeSegments(edge.vertices, edge.closed)) out.push(...segmentCircleHits(p, q, center, radius));
			return withAngle(out);
		}
		case "CIRCLE":
			return withAngle(circleCircleHits(center, radius, edge.center, edge.radius));
		case "ARC":
			return withAngle(circleCircleHits(center, radius, edge.center, edge.radius)).filter((h) =>
				angleInArc((Math.atan2(h.point.y - edge.center.y, h.point.x - edge.center.x) * 180) / Math.PI, edge.startAngle, edge.endAngle)
			);
		default:
			return [];
	}
}

/**
 * The point to trim a LINE target back to: the crossing with `edge` nearest the
 * `near` endpoint, but only counting crossings that lie strictly *inside* the
 * current segment (`far`..`near`) — trim only ever shortens, never extends.
 */
export function trimLinePoint(far: Point2, near: Point2, edge: RenderEntity): Point2 | null {
	const hits = lineEdgeHits(far, near, edge).filter((h) => h.t > 1e-6 && h.t < 1 - 1e-6);
	if (!hits.length) return null;
	return hits.reduce((a, b) => (b.t > a.t ? b : a)).point;
}

/**
 * The point to extend a LINE target out to: the crossing with `edge` nearest the
 * `near` endpoint, but only counting crossings strictly *beyond* it (t > 1) —
 * extend only ever lengthens, never shortens.
 */
export function extendLinePoint(far: Point2, near: Point2, edge: RenderEntity): Point2 | null {
	const hits = lineEdgeHits(far, near, edge).filter((h) => h.t > 1 + 1e-6);
	if (!hits.length) return null;
	return hits.reduce((a, b) => (b.t < a.t ? b : a)).point;
}

/** Parametric t along a→b where it crosses finite segment p1-p2, or null if parallel/outside p1-p2. */
function segmentLineParam(a: Point2, b: Point2, p1: Point2, p2: Point2): number | null {
	const d1x = b.x - a.x, d1y = b.y - a.y;
	const d2x = p2.x - p1.x, d2y = p2.y - p1.y;
	const denom = d1x * d2y - d1y * d2x;
	if (Math.abs(denom) < 1e-12) return null;
	const t = ((p1.x - a.x) * d2y - (p1.y - a.y) * d2x) / denom;
	const u = ((p1.x - a.x) * d1y - (p1.y - a.y) * d1x) / denom;
	if (u < -1e-9 || u > 1 + 1e-9) return null;
	return t;
}

/**
 * Parallel line segments at `angleDeg`, spaced `spacing` apart, clipped to the
 * inside of a simple (possibly concave) closed polygon — a classic "hatch
 * lines" pattern fill. Uses the even-odd rule: a straight line crossing a
 * simple polygon boundary alternates inside/outside at each crossing, so
 * pairing sorted crossings (0,1), (2,3), ... gives the inside spans.
 */
export function hatchLines(boundary: Point2[], angleDeg: number, spacing: number): Array<[Point2, Point2]> {
	if (boundary.length < 3 || !(spacing > 1e-9)) return [];
	const rad = (angleDeg * Math.PI) / 180;
	const dir = { x: Math.cos(rad), y: Math.sin(rad) };
	const normal = { x: -dir.y, y: dir.x };
	let minN = Infinity, maxN = -Infinity, minD = Infinity, maxD = -Infinity;
	for (const p of boundary) {
		const n = p.x * normal.x + p.y * normal.y;
		const d = p.x * dir.x + p.y * dir.y;
		if (n < minN) minN = n;
		if (n > maxN) maxN = n;
		if (d < minD) minD = d;
		if (d > maxD) maxD = d;
	}
	const pad = maxD - minD + spacing * 2 + 1;
	const n = boundary.length;
	const segments: Array<[Point2, Point2]> = [];
	const startK = Math.ceil(minN / spacing);
	const endK = Math.floor(maxN / spacing);
	for (let k = startK; k <= endK; k++) {
		const off = k * spacing;
		const a = { x: normal.x * off + dir.x * (minD - pad), y: normal.y * off + dir.y * (minD - pad) };
		const b = { x: normal.x * off + dir.x * (maxD + pad), y: normal.y * off + dir.y * (maxD + pad) };
		const hits: number[] = [];
		for (let i = 0; i < n; i++) {
			const t = segmentLineParam(a, b, boundary[i], boundary[(i + 1) % n]);
			if (t !== null) hits.push(t);
		}
		hits.sort((x, y) => x - y);
		const dedup: number[] = [];
		for (const t of hits) {
			if (!dedup.length || t - dedup[dedup.length - 1] > 1e-9) dedup.push(t);
		}
		for (let i = 0; i + 1 < dedup.length; i += 2) {
			const t0 = dedup[i], t1 = dedup[i + 1];
			segments.push([
				{ x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 },
				{ x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 },
			]);
		}
	}
	return segments;
}

/**
 * The new angle (deg) to trim an ARC target's start or end to: the crossing with
 * `edge` nearest the clicked side, counting only crossings strictly inside the
 * arc's current sweep. `nearIsEnd` says whether the click was nearer the arc's
 * end (vs. its start).
 */
export function trimArcAngle(center: Point2, radius: number, startAngle: number, endAngle: number, nearIsEnd: boolean, edge: RenderEntity): number | null {
	const totalSweep = norm360(endAngle - startAngle) || 360;
	const candidates = circleEdgeHits(center, radius, edge)
		.filter((h) => angleInArc(h.angleDeg, startAngle, endAngle))
		.map((h) => ({ angleDeg: h.angleDeg, t: nearIsEnd ? norm360(h.angleDeg - startAngle) / totalSweep : 1 - norm360(h.angleDeg - startAngle) / totalSweep }))
		.filter((h) => h.t > 1e-6 && h.t < 1 - 1e-6);
	if (!candidates.length) return null;
	return candidates.reduce((a, b) => (b.t > a.t ? b : a)).angleDeg;
}

export interface LinearDimensionGeometry {
	extLine1: [Point2, Point2];
	extLine2: [Point2, Point2];
	dimLine: [Point2, Point2];
	arrow1: [Point2, Point2, Point2];
	arrow2: [Point2, Point2, Point2];
	textPos: Point2;
	/** degrees, kept within (-90, 90] so the text stays upright/readable */
	textRotation: number;
	length: number;
}

/**
 * Geometry for a linear dimension between p1 and p2, offset out to the line
 * through `through` (the third click that places the dimension line). Not a
 * parametric DXF DIMENSION entity — this builds plain LINE/LWPOLYLINE/TEXT
 * geometry that renders identically everywhere and stays editable with the
 * ordinary tools.
 */
export function buildLinearDimension(p1: Point2, p2: Point2, through: Point2, arrowSize: number, textGap: number): LinearDimensionGeometry | null {
	const dx = p2.x - p1.x, dy = p2.y - p1.y;
	const length = Math.hypot(dx, dy);
	if (length < 1e-9) return null;
	const ux = dx / length, uy = dy / length;
	const nx = -uy, ny = ux;
	const offset = (through.x - p1.x) * nx + (through.y - p1.y) * ny;
	const d1: Point2 = { x: p1.x + nx * offset, y: p1.y + ny * offset };
	const d2: Point2 = { x: p2.x + nx * offset, y: p2.y + ny * offset };
	const arrow = (tip: Point2, dirX: number, dirY: number): [Point2, Point2, Point2] => {
		const baseX = tip.x + dirX * arrowSize, baseY = tip.y + dirY * arrowSize;
		const halfW = arrowSize * 0.35;
		const px = -dirY * halfW, py = dirX * halfW;
		return [tip, { x: baseX + px, y: baseY + py }, { x: baseX - px, y: baseY - py }];
	};
	const mid: Point2 = { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 };
	const sign = offset >= 0 ? 1 : -1;
	let textRotation = (Math.atan2(uy, ux) * 180) / Math.PI;
	if (textRotation > 90) textRotation -= 180;
	else if (textRotation <= -90) textRotation += 180;
	return {
		extLine1: [p1, d1],
		extLine2: [p2, d2],
		dimLine: [d1, d2],
		arrow1: arrow(d1, ux, uy),
		arrow2: arrow(d2, -ux, -uy),
		textPos: { x: mid.x + nx * textGap * sign, y: mid.y + ny * textGap * sign },
		textRotation,
		length,
	};
}
