import { describe, it, expect } from "vitest";
import {
	circumcircle,
	lineLineIntersect,
	lineCircleHits,
	circleCircleHits,
	lineEdgeHits,
	circleEdgeHits,
	angleInArc,
	computeFillet,
	computeChamfer,
	trimLinePoint,
	extendLinePoint,
	trimArcAngle,
	entityLength,
	entityArea,
	joinLineChain,
	ellipsePoints,
	isFullEllipseSweep,
	buildLinearDimension,
} from "../src/core/geom/geometry2d";
import type { LineEntity, CircleEntity, ArcEntity, PolylineEntity, EllipseEntity } from "../src/core/model/types";

describe("circumcircle", () => {
	it("finds the centre/radius of a circle through three points", () => {
		const c = circumcircle({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 });
		expect(c).not.toBeNull();
		expect(c!.center.x).toBeCloseTo(0, 6);
		expect(c!.center.y).toBeCloseTo(0, 6);
		expect(c!.radius).toBeCloseTo(1, 6);
	});

	it("returns null for collinear points", () => {
		expect(circumcircle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeNull();
	});
});

describe("lineLineIntersect", () => {
	it("finds the crossing point of two non-parallel lines", () => {
		const p = lineLineIntersect({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 });
		expect(p).toEqual({ x: 0, y: 0 });
	});

	it("returns null for parallel lines", () => {
		expect(lineLineIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeNull();
	});
});

describe("lineCircleHits / circleCircleHits", () => {
	it("finds two points where a line crosses a circle", () => {
		const hits = lineCircleHits({ x: -5, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 0 }, 2);
		expect(hits).toHaveLength(2);
		const xs = hits.map((h) => h.point.x).sort((a, b) => a - b);
		expect(xs[0]).toBeCloseTo(-2, 6);
		expect(xs[1]).toBeCloseTo(2, 6);
	});

	it("finds the two intersections of two overlapping circles", () => {
		const hits = circleCircleHits({ x: -1, y: 0 }, Math.SQRT2, { x: 1, y: 0 }, Math.SQRT2);
		expect(hits).toHaveLength(2);
		for (const p of hits) expect(Math.abs(p.y)).toBeCloseTo(1, 6);
	});
});

describe("angleInArc", () => {
	it("wraps correctly across 0/360", () => {
		expect(angleInArc(350, 340, 10)).toBe(true);
		expect(angleInArc(20, 340, 10)).toBe(false);
	});
});

describe("edge hits (trim/extend cutting-edge helper)", () => {
	it("bounds a line-vs-line hit to the cutting edge's finite segment", () => {
		const edge: LineEntity = { id: "E", type: "LINE", layer: "0", color: 0, start: { x: 5, y: -5 }, end: { x: 5, y: 5 } };
		const hits = lineEdgeHits({ x: 0, y: 0 }, { x: 10, y: 0 }, edge);
		expect(hits).toHaveLength(1);
		expect(hits[0].point.x).toBeCloseTo(5, 6);
		expect(hits[0].t).toBeCloseTo(0.5, 6);
	});

	it("finds no hit when the cutting edge segment doesn't reach the line", () => {
		const edge: LineEntity = { id: "E", type: "LINE", layer: "0", color: 0, start: { x: 5, y: 1 }, end: { x: 5, y: 5 } };
		expect(lineEdgeHits({ x: 0, y: 0 }, { x: 10, y: 0 }, edge)).toHaveLength(0);
	});

	it("bounds a line-vs-circle hit to an ARC's angle range", () => {
		const arc: ArcEntity = { id: "A", type: "ARC", layer: "0", color: 0, center: { x: 0, y: 0 }, radius: 2, startAngle: 0, endAngle: 90 };
		// horizontal line through y=0 crosses the full circle at x=-2 and x=2, but only x=2 (angle 0) is on this quarter-arc.
		const hits = lineEdgeHits({ x: -10, y: 0 }, { x: 10, y: 0 }, arc);
		expect(hits).toHaveLength(1);
		expect(hits[0].point.x).toBeCloseTo(2, 6);
	});

	it("finds line-vs-polyline hits per segment", () => {
		const poly: PolylineEntity = {
			id: "P", type: "LWPOLYLINE", layer: "0", color: 0, closed: false,
			vertices: [{ x: 5, y: -5 }, { x: 5, y: 5 }, { x: 8, y: 5 }],
		};
		const hits = lineEdgeHits({ x: 0, y: 0 }, { x: 10, y: 0 }, poly);
		expect(hits).toHaveLength(1);
		expect(hits[0].point.x).toBeCloseTo(5, 6);
	});

	it("gives the crossing angle for a circle-vs-line hit", () => {
		const edge: LineEntity = { id: "E", type: "LINE", layer: "0", color: 0, start: { x: -5, y: 0 }, end: { x: 5, y: 0 } };
		const hits = circleEdgeHits({ x: 0, y: 0 }, 3, edge);
		expect(hits).toHaveLength(2);
		const angles = hits.map((h) => h.angleDeg).sort((a, b) => a - b);
		expect(angles[0]).toBeCloseTo(0, 4);
		expect(angles[1]).toBeCloseTo(180, 4);
	});

	it("bounds circle-vs-circle hits to the cutting edge CIRCLE (always full)", () => {
		const edge: CircleEntity = { id: "C", type: "CIRCLE", layer: "0", color: 0, center: { x: 2, y: 0 }, radius: 2 };
		const hits = circleEdgeHits({ x: 0, y: 0 }, 2, edge);
		expect(hits).toHaveLength(2);
	});
});

describe("computeFillet / computeChamfer", () => {
	// An "L" bracket: a horizontal leg (0,0)-(10,0) and a vertical leg (10,0)-(10,10),
	// meeting flush at the corner (10,0) — the single most common real-world case
	// (two separate lines that already share an endpoint).
	const leg1: LineEntity = { id: "L1", type: "LINE", layer: "0", color: 0, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
	const leg2: LineEntity = { id: "L2", type: "LINE", layer: "0", color: 0, start: { x: 10, y: 0 }, end: { x: 10, y: 10 } };
	const click1 = { x: 9, y: 0 }; // near the corner on leg1
	const click2 = { x: 10, y: 1 }; // near the corner on leg2

	it("fillet shortens each flush leg back from the corner by the tangent distance and adds a tangent ARC", () => {
		const r = 2;
		const result = computeFillet(leg1, click1, leg2, click2, r);
		expect(result).not.toBeNull();
		// theta=90 deg (right angle) => tanDist = r / tan(45deg) = r.
		expect(result!.pair1).toBe(1); // leg1's END (10,0) is the one nearest the corner/click
		expect(result!.point1.x).toBeCloseTo(10 - r, 6);
		expect(result!.point1.y).toBeCloseTo(0, 6);
		expect(result!.pair2).toBe(0); // leg2's START (10,0) is nearest the corner/click
		expect(result!.point2.x).toBeCloseTo(10, 6);
		expect(result!.point2.y).toBeCloseTo(r, 6);
		// centre must sit exactly `r` from the tangent point on each leg.
		expect(Math.hypot(result!.center.x - result!.point1.x, result!.center.y - result!.point1.y)).toBeCloseTo(r, 6);
		expect(Math.hypot(result!.center.x - result!.point2.x, result!.center.y - result!.point2.y)).toBeCloseTo(r, 6);
		expect(result!.center.x).toBeCloseTo(10 - r, 6);
		expect(result!.center.y).toBeCloseTo(r, 6);
	});

	it("fillet refuses a radius that would overshoot the far endpoint", () => {
		expect(computeFillet(leg1, click1, leg2, click2, 50)).toBeNull();
	});

	it("chamfer pulls each flush leg back from the corner by the equal distance", () => {
		const d = 3;
		const result = computeChamfer(leg1, click1, leg2, click2, d);
		expect(result).not.toBeNull();
		expect(result!.point1).toEqual({ x: 10 - d, y: 0 });
		expect(result!.point2).toEqual({ x: 10, y: d });
	});

	it("chamfer refuses a distance that would overshoot the far endpoint", () => {
		expect(computeChamfer(leg1, click1, leg2, click2, 50)).toBeNull();
	});

	it("returns null for parallel lines (no corner to round)", () => {
		const parallel: LineEntity = { id: "L3", type: "LINE", layer: "0", color: 0, start: { x: 0, y: 5 }, end: { x: 10, y: 5 } };
		expect(computeFillet(leg1, click1, parallel, { x: 5, y: 5 }, 2)).toBeNull();
	});
});

describe("trimLinePoint / extendLinePoint / trimArcAngle", () => {
	it("trims a LINE back to the nearest crossing inside its current segment", () => {
		const cutter: LineEntity = { id: "E", type: "LINE", layer: "0", color: 0, start: { x: 6, y: -5 }, end: { x: 6, y: 5 } };
		// target LINE runs (0,0)->(10,0); trimming from the near=(10,0) side should stop at x=6.
		const p = trimLinePoint({ x: 0, y: 0 }, { x: 10, y: 0 }, cutter);
		expect(p).not.toBeNull();
		expect(p!.x).toBeCloseTo(6, 6);
		expect(p!.y).toBeCloseTo(0, 6);
	});

	it("trim finds no point when the cutting edge doesn't cross the current segment", () => {
		const cutter: LineEntity = { id: "E", type: "LINE", layer: "0", color: 0, start: { x: 16, y: -5 }, end: { x: 16, y: 5 } };
		expect(trimLinePoint({ x: 0, y: 0 }, { x: 10, y: 0 }, cutter)).toBeNull();
	});

	it("extends a LINE out to the nearest crossing beyond its current end", () => {
		const boundary: LineEntity = { id: "B", type: "LINE", layer: "0", color: 0, start: { x: 10, y: -5 }, end: { x: 10, y: 5 } };
		// target LINE runs (0,0)->(6,0); extending the near=(6,0) end should reach x=10.
		const p = extendLinePoint({ x: 0, y: 0 }, { x: 6, y: 0 }, boundary);
		expect(p).not.toBeNull();
		expect(p!.x).toBeCloseTo(10, 6);
		expect(p!.y).toBeCloseTo(0, 6);
	});

	it("extend finds no point when the boundary is behind the current segment, not ahead of it", () => {
		const boundary: LineEntity = { id: "B", type: "LINE", layer: "0", color: 0, start: { x: -10, y: -5 }, end: { x: -10, y: 5 } };
		expect(extendLinePoint({ x: 0, y: 0 }, { x: 6, y: 0 }, boundary)).toBeNull();
	});

	it("trims an ARC's end angle back to a crossing inside its sweep", () => {
		// A quarter-circle ARC from 0deg to 90deg, radius 5; a vertical cutting line at x=3
		// crosses it once inside the sweep (near 53deg); clicking near the end (90deg) trims there.
		const cutter: LineEntity = { id: "E", type: "LINE", layer: "0", color: 0, start: { x: 3, y: -10 }, end: { x: 3, y: 10 } };
		const angle = trimArcAngle({ x: 0, y: 0 }, 5, 0, 90, true, cutter);
		expect(angle).not.toBeNull();
		expect(angle!).toBeCloseTo((Math.acos(3 / 5) * 180) / Math.PI, 4);
	});
});

describe("entityLength / entityArea", () => {
	it("sums a LINE's straight-line length", () => {
		const line: LineEntity = { id: "L", type: "LINE", layer: "0", color: 0, start: { x: 0, y: 0 }, end: { x: 3, y: 4 } };
		expect(entityLength(line)).toBeCloseTo(5, 6);
	});

	it("computes a CIRCLE's circumference and area", () => {
		const circle: CircleEntity = { id: "C", type: "CIRCLE", layer: "0", color: 0, center: { x: 0, y: 0 }, radius: 2 };
		expect(entityLength(circle)).toBeCloseTo(2 * Math.PI * 2, 6);
		expect(entityArea(circle)?.area).toBeCloseTo(Math.PI * 4, 6);
	});

	it("computes an ARC's arc-length from its sweep", () => {
		const arc: ArcEntity = { id: "A", type: "ARC", layer: "0", color: 0, center: { x: 0, y: 0 }, radius: 2, startAngle: 0, endAngle: 90 };
		expect(entityLength(arc)).toBeCloseTo((Math.PI / 2) * 2, 6);
	});

	it("computes a closed polyline's area via the shoelace formula and returns null for an open one", () => {
		const square: PolylineEntity = {
			id: "P", type: "LWPOLYLINE", layer: "0", color: 0, closed: true,
			vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }],
		};
		expect(entityArea(square)?.area).toBeCloseTo(12, 6);
		expect(entityArea(square)?.perimeter).toBeCloseTo(14, 6);
		expect(entityArea({ ...square, closed: false })).toBeNull();
	});
});

describe("joinLineChain", () => {
	it("chains segments given out of order and in mixed directions into one open polyline", () => {
		const segs = [
			{ start: { x: 10, y: 0 }, end: { x: 20, y: 0 } }, // middle, forward
			{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, // first, forward
			{ start: { x: 30, y: 0 }, end: { x: 20, y: 0 } }, // last, reversed
		];
		const result = joinLineChain(segs, 1e-6);
		expect(result).not.toBeNull();
		expect(result!.closed).toBe(false);
		expect(result!.vertices).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }]);
	});

	it("detects a closed loop and drops the duplicated closing vertex", () => {
		const segs = [
			{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
			{ start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
			{ start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
			{ start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
		];
		const result = joinLineChain(segs, 1e-6);
		expect(result).not.toBeNull();
		expect(result!.closed).toBe(true);
		expect(result!.vertices).toHaveLength(4);
	});

	it("returns null when the segments don't form a single connected chain", () => {
		const segs = [
			{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
			{ start: { x: 100, y: 100 }, end: { x: 110, y: 100 } }, // disconnected
		];
		expect(joinLineChain(segs, 1e-6)).toBeNull();
	});
});

describe("ellipsePoints / isFullEllipseSweep", () => {
	it("detects a full sweep (0/360) vs a partial one", () => {
		expect(isFullEllipseSweep(0, 360)).toBe(true);
		expect(isFullEllipseSweep(0, 180)).toBe(false);
	});

	it("samples the major- and minor-axis endpoints at t=0 and t=90deg", () => {
		const pts = ellipsePoints({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.5, 0, 360, 4);
		// steps=4 over a full 360deg sweep: t = 0, 90, 180, 270, 360(=0).
		expect(pts[0]).toEqual({ x: 4, y: 0 }); // major axis endpoint (t=0)
		expect(pts[1].x).toBeCloseTo(0, 6);
		expect(pts[1].y).toBeCloseTo(2, 6); // minor axis endpoint: ratio(0.5) * major radius(4) = 2
	});

	it("computes an ELLIPSE's area/perimeter via entityArea only when it's a full sweep", () => {
		const ellipse: EllipseEntity = {
			id: "E", type: "ELLIPSE", layer: "0", color: 0,
			center: { x: 0, y: 0 }, majorAxisEndpoint: { x: 4, y: 0 }, ratio: 0.5, startAngle: 0, endAngle: 360,
		};
		expect(entityArea(ellipse)?.area).toBeCloseTo(Math.PI * 4 * 2, 6);
		expect(entityArea({ ...ellipse, endAngle: 180 })).toBeNull();
	});
});

describe("buildLinearDimension", () => {
	it("places the dimension line offset toward the third point, with arrows at each end and centred, upright text", () => {
		const g = buildLinearDimension({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 }, 1, 1);
		expect(g).not.toBeNull();
		expect(g!.length).toBeCloseTo(10, 6);
		// dimension line is offset toward the third point (positive y), parallel to p1-p2.
		expect(g!.dimLine[0].y).toBeCloseTo(3, 6);
		expect(g!.dimLine[1].y).toBeCloseTo(3, 6);
		expect(g!.dimLine[0].x).toBeCloseTo(0, 6);
		expect(g!.dimLine[1].x).toBeCloseTo(10, 6);
		// arrow tips sit exactly at the dimension line's endpoints.
		expect(g!.arrow1[0]).toEqual(g!.dimLine[0]);
		expect(g!.arrow2[0]).toEqual(g!.dimLine[1]);
		// text sits above the dimension line, at the horizontal midpoint, upright (0deg for a horizontal dimension).
		expect(g!.textPos.x).toBeCloseTo(5, 6);
		expect(g!.textPos.y).toBeGreaterThan(3);
		expect(g!.textRotation).toBeCloseTo(0, 6);
	});

	it("flips text rotation to stay upright when the dimension runs right-to-left", () => {
		const g = buildLinearDimension({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 3 }, 1, 1);
		expect(g!.textRotation).toBeCloseTo(0, 6);
	});

	it("returns null for coincident points", () => {
		expect(buildLinearDimension({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 }, 1, 1)).toBeNull();
	});
});
