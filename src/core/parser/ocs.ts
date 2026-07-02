import type { Point2 } from "../model/types";

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export const WCS_NORMAL: Vec3 = { x: 0, y: 0, z: 1 };

function cross(a: Vec3, b: Vec3): Vec3 {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x,
	};
}

function normalize(v: Vec3): Vec3 {
	const len = Math.hypot(v.x, v.y, v.z) || 1;
	return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function isDefaultNormal(n: Vec3): boolean {
	return Math.abs(n.x) < 1e-9 && Math.abs(n.y) < 1e-9 && Math.abs(n.z - 1) < 1e-9;
}

/**
 * AutoCAD "Arbitrary Axis Algorithm": derive the OCS basis (Ax, Ay) from an
 * extrusion normal. Entities like CIRCLE/ARC/LWPOLYLINE/TEXT store their points
 * in this Object Coordinate System; a normal of (0,0,-1) mirrors X, which is the
 * classic "renders shifted in my viewer but correct in AutoCAD" cause.
 */
function arbitraryAxis(normal: Vec3): { ax: Vec3; ay: Vec3; n: Vec3 } {
	const n = normalize(normal);
	const threshold = 1 / 64;
	let ax: Vec3;
	if (Math.abs(n.x) < threshold && Math.abs(n.y) < threshold) {
		ax = cross({ x: 0, y: 1, z: 0 }, n);
	} else {
		ax = cross({ x: 0, y: 0, z: 1 }, n);
	}
	ax = normalize(ax);
	const ay = normalize(cross(n, ax));
	return { ax, ay, n };
}

/** Transform an OCS point (with optional elevation z) into world XY. */
export function ocsToWorld(p: { x: number; y: number; z?: number }, normal: Vec3): Point2 {
	if (isDefaultNormal(normal)) return { x: p.x, y: p.y };
	const { ax, ay, n } = arbitraryAxis(normal);
	const z = p.z ?? 0;
	return {
		x: p.x * ax.x + p.y * ay.x + z * n.x,
		y: p.x * ax.y + p.y * ay.y + z * n.y,
	};
}
