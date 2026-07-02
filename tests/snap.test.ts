import { describe, it, expect } from "vitest";
import { computeSnap, gridSnap, DEFAULT_SNAP } from "../src/interaction/snap";
import type { RenderEntity } from "../src/core/model/types";

const line = (id: string, x1: number, y1: number, x2: number, y2: number): RenderEntity => ({
	id, type: "LINE", layer: "0", color: 0, start: { x: x1, y: y1 }, end: { x: x2, y: y2 },
});
const circle = (id: string, x: number, y: number, r: number): RenderEntity => ({
	id, type: "CIRCLE", layer: "0", color: 0, center: { x, y }, radius: r,
});

describe("snap engine", () => {
	it("prefers endpoint over midpoint when both are in tolerance", () => {
		const s = computeSnap({ x: 0.1, y: 0.1 }, [line("a", 0, 0, 10, 0)], DEFAULT_SNAP, 1);
		expect(s?.type).toBe("endpoint");
		expect(s?.point).toEqual({ x: 0, y: 0 });
	});

	it("snaps to a line midpoint", () => {
		const s = computeSnap({ x: 5.2, y: 0.1 }, [line("a", 0, 0, 10, 0)], DEFAULT_SNAP, 1);
		expect(s?.type).toBe("midpoint");
		expect(s?.point).toEqual({ x: 5, y: 0 });
	});

	it("snaps to a circle center and quadrant", () => {
		const c = circle("c", 0, 0, 5);
		expect(computeSnap({ x: 0.2, y: 0.1 }, [c], DEFAULT_SNAP, 1)?.type).toBe("center");
		const q = computeSnap({ x: 5.1, y: 0.1 }, [c], DEFAULT_SNAP, 1);
		expect(q?.type).toBe("quadrant");
		expect(q?.point).toEqual({ x: 5, y: 0 });
	});

	it("finds the intersection of two crossing lines", () => {
		const s = computeSnap(
			{ x: 5.1, y: 4.9 },
			[line("a", 0, 5, 10, 5), line("b", 5, 0, 5, 10)],
			DEFAULT_SNAP,
			1
		);
		expect(s?.type).toBe("intersection");
		expect(s?.point.x).toBeCloseTo(5);
		expect(s?.point.y).toBeCloseTo(5);
	});

	it("returns null when nothing is near and grid is off", () => {
		expect(computeSnap({ x: 100, y: 100 }, [line("a", 0, 0, 1, 0)], DEFAULT_SNAP, 0.5)).toBeNull();
	});

	it("grid snap rounds to spacing", () => {
		expect(gridSnap({ x: 2.3, y: 4.8 }, 1).point).toEqual({ x: 2, y: 5 });
		expect(gridSnap({ x: 2.3, y: 4.8 }, 5).point).toEqual({ x: 0, y: 5 });
	});
});
