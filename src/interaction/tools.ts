import type { Tool, ToolContext, ToolId } from "./types";
import type { Point2, NewEntitySpec, RenderEntity, LineEntity, ArcEntity } from "../core/model/types";
import type { OverlayPrim } from "../render/overlay";
import type { Command } from "../core/command/commands";
import {
	AddEntityCommand,
	MoveCommand,
	MoveVertexCommand,
	RotateCommand,
	ScaleCommand,
	MirrorCommand,
	CopyCommand,
	PolarCopyCommand,
	BatchCommand,
	SetPropsCommand,
	ChangeLayerCommand,
	ChangeColorCommand,
} from "../core/command/commands";
import { AnnotationStore } from "../core/annotation/AnnotationStore";
import { circumcircle, angleInArc, isCuttingEdgeType, computeFillet, computeChamfer, trimLinePoint, extendLinePoint, trimArcAngle } from "../core/geom/geometry2d";

/** Prompt for a number via the shared text modal; returns null if cancelled or unparsable. */
async function promptNumber(ctx: ToolContext, title: string, initial: number): Promise<number | null> {
	const s = await ctx.promptText(String(initial), title);
	if (s === null) return null;
	const n = parseFloat(s);
	return Number.isFinite(n) ? n : null;
}

function snapMarker(ctx: ToolContext, world: Point2): { p: Point2; prim: OverlayPrim | null } {
	const s = ctx.snap(world);
	if (!s) return { p: world, prim: null };
	const style =
		s.type === "grid" ? "dot"
		: s.type === "center" ? "circle"
		: s.type === "midpoint" ? "triangle"
		: s.type === "extension" ? "diamond"
		: "square";
	return { p: s.point, prim: { kind: "marker", at: s.point, style, color: ctx.accent, sizePx: 7 } };
}

function dist(a: Point2, b: Point2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}
function norm360(deg: number): number {
	return ((deg % 360) + 360) % 360;
}
function norm180(deg: number): number {
	let d = norm360(deg);
	if (d > 180) d -= 360;
	return d;
}
function angleDeg(c: Point2, p: Point2): number {
	return norm360((Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI);
}

/** Dashed arc preview as a polyline between two angles (CCW). */
function arcOutline(c: Point2, r: number, startDeg: number, endDeg: number, color: number): OverlayPrim[] {
	const start = (startDeg * Math.PI) / 180;
	let sweep = ((endDeg - startDeg) * Math.PI) / 180;
	if (sweep <= 0) sweep += Math.PI * 2;
	const pts: Point2[] = [];
	const steps = 48;
	for (let i = 0; i <= steps; i++) {
		const a = start + (sweep * i) / steps;
		pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
	}
	return [{ kind: "line", pts, color, dashed: true }];
}

/** Dashed preview of an entity rotated `deg` about a pivot (for the rotate tool). */
function outlineRotated(e: RenderEntity, pivot: Point2, deg: number, color: number): OverlayPrim[] {
	const rad = (deg * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const rot = (p: Point2): Point2 => {
		const ox = p.x - pivot.x;
		const oy = p.y - pivot.y;
		return { x: pivot.x + ox * cos - oy * sin, y: pivot.y + ox * sin + oy * cos };
	};
	const pts = outlinePoints(e);
	if (pts) return [{ kind: "line", pts: pts.map(rot), color, dashed: true }];
	if (e.type === "CIRCLE") return [{ kind: "circle", center: rot(e.center), radius: e.radius, color, dashed: true }];
	if (e.type === "ARC") return arcOutline(rot(e.center), e.radius, e.startAngle + deg, e.endAngle + deg, color);
	if (e.type === "TEXT" || e.type === "MTEXT") return [{ kind: "marker", at: rot(e.position), style: "square", color, sizePx: 6 }];
	return [];
}

/** Dashed preview of an entity scaled by `factor` about a pivot (for the scale tool). */
function outlineScaled(e: RenderEntity, pivot: Point2, factor: number, color: number): OverlayPrim[] {
	const scale = (p: Point2): Point2 => ({ x: pivot.x + (p.x - pivot.x) * factor, y: pivot.y + (p.y - pivot.y) * factor });
	const pts = outlinePoints(e);
	if (pts) return [{ kind: "line", pts: pts.map(scale), color, dashed: true }];
	if (e.type === "CIRCLE") return [{ kind: "circle", center: scale(e.center), radius: e.radius * factor, color, dashed: true }];
	if (e.type === "ARC") return arcOutline(scale(e.center), e.radius * factor, e.startAngle, e.endAngle, color);
	if (e.type === "TEXT" || e.type === "MTEXT") return [{ kind: "marker", at: scale(e.position), style: "square", color, sizePx: 6 }];
	return [];
}

/** Reflect a point across the line through `a`-`b`. */
function reflectPoint(p: Point2, a: Point2, b: Point2): Point2 {
	const lx = b.x - a.x, ly = b.y - a.y;
	const len2 = lx * lx + ly * ly;
	if (len2 < 1e-12) return p;
	const vx = p.x - a.x, vy = p.y - a.y;
	const t = (vx * lx + vy * ly) / len2;
	const fx = a.x + t * lx, fy = a.y + t * ly;
	return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}

/** Dashed preview of an entity mirrored across line `a`-`b` (for the mirror tool). */
function outlineMirrored(e: RenderEntity, a: Point2, b: Point2, color: number): OverlayPrim[] {
	const refl = (p: Point2) => reflectPoint(p, a, b);
	const pts = outlinePoints(e);
	if (pts) return [{ kind: "line", pts: pts.map(refl), color, dashed: true }];
	if (e.type === "CIRCLE") return [{ kind: "circle", center: refl(e.center), radius: e.radius, color, dashed: true }];
	if (e.type === "ARC") {
		const theta = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
		const newStart = norm360(2 * theta - e.endAngle);
		const newEnd = norm360(2 * theta - e.startAngle);
		return arcOutline(refl(e.center), e.radius, newStart, newEnd, color);
	}
	if (e.type === "TEXT" || e.type === "MTEXT") return [{ kind: "marker", at: refl(e.position), style: "square", color, sizePx: 6 }];
	return [];
}

// ---------------------------------------------------------------------------

interface Grip {
	mode: "vertex" | "whole";
	pairIndex?: number;
	point: Point2;
}

function gripsOf(e: RenderEntity): Grip[] {
	switch (e.type) {
		case "LINE":
			return [
				{ mode: "vertex", pairIndex: 0, point: e.start },
				{ mode: "vertex", pairIndex: 1, point: e.end },
			];
		case "LWPOLYLINE":
		case "POLYLINE":
			return e.vertices.map((v, i) => ({ mode: "vertex", pairIndex: i, point: v }));
		case "CIRCLE":
		case "ARC":
			return [{ mode: "whole", point: e.center }];
		case "TEXT":
		case "MTEXT":
			return [{ mode: "whole", point: e.position }];
		default:
			return [];
	}
}

/**
 * Select + move. Click selects; drag a grip to move an endpoint/vertex, drag the
 * body to move the whole entity, drag a note to reposition it. Empty-space drag
 * still pans (handled by the renderer when this tool doesn't consume the press).
 */
export class SelectTool implements Tool {
	readonly id: ToolId = "select";
	readonly panWithLeftDrag = true;
	private drag: null | {
		kind: "vertex" | "whole" | "group" | "annotation";
		id: string;
		ids?: string[];
		pairIndex?: number;
		gripOrigin: Point2;
		cursorStart: Point2;
		/** reference point that OSNAP targets snap onto during the move */
		basePoint: Point2;
	} = null;

	constructor(private ctx: ToolContext) {}

	pointer(phase: string, world: Point2, ev?: PointerEvent): boolean | void {
		if (phase === "down") return this.onDown(world);
		if (phase === "move") return this.onMove(world, ev);
		if (phase === "up") return this.onUp(world);
		if (phase === "click") {
			const id = this.ctx.pick(world);
			if (ev && (ev.ctrlKey || ev.metaKey)) this.ctx.toggleSelection(id);
			else this.ctx.select(id);
		}
	}

	private tol(): number {
		return this.ctx.pixelSize() * 10;
	}

	/** Snap the drag target, offset the whole geometry by (target - basePoint). */
	private moveDelta(world: Point2, basePoint: Point2): { dx: number; dy: number; target: Point2 } {
		const s = this.ctx.snap(world);
		const target = s ? s.point : world;
		return { dx: target.x - basePoint.x, dy: target.y - basePoint.y, target };
	}

	private onDown(world: Point2): boolean {
		const doc = this.ctx.doc();
		if (!doc) return false;

		// 1. grab a note annotation?
		const annoId = this.ctx.annotationAt(world);
		if (annoId) {
			this.drag = { kind: "annotation", id: annoId, gripOrigin: world, cursorStart: world, basePoint: world };
			return true;
		}

		const selIds = this.ctx.selectedIds().filter((id) => doc.isEditable(id));

		// 2. multiple selected and grabbing one of them: move the whole group.
		if (selIds.length > 1) {
			const hit = this.ctx.pick(world);
			if (hit && selIds.includes(hit)) {
				this.drag = { kind: "group", id: hit, ids: selIds, gripOrigin: world, cursorStart: world, basePoint: world };
				return true;
			}
		}

		// 3. grab a grip / body of the selected editable entity?
		const selId = this.ctx.selectedId();
		if (selId && doc.isEditable(selId)) {
			const e = doc.getEntity(selId);
			if (e) {
				let best: Grip | null = null;
				let bestD = this.tol();
				for (const g of gripsOf(e)) {
					const d = dist(g.point, world);
					if (d <= bestD) {
						bestD = d;
						best = g;
					}
				}
				if (best) {
					this.drag = {
						kind: best.mode === "vertex" ? "vertex" : "whole",
						id: selId,
						pairIndex: best.pairIndex,
						gripOrigin: { ...best.point },
						cursorStart: world,
						basePoint: { ...best.point },
					};
					return true;
				}
				if (this.ctx.pick(world) === selId) {
					// Grab the body: base the move on the entity's nearest characteristic
					// point so it snaps feature-to-feature, else free-drag from cursor.
					const base = nearestGrip(e, world, this.tol()) ?? world;
					this.drag = { kind: "whole", id: selId, gripOrigin: world, cursorStart: world, basePoint: base };
					return true;
				}
			}
		}
		return false; // let the renderer pan / click-to-select
	}

	private onMove(world: Point2, ev?: PointerEvent): void {
		if (!this.drag) {
			// hover: show grips of the selected entity so it's clear it can be edited
			this.showGrips();
			return;
		}
		if (ev && ev.buttons === 0) {
			// pointer released outside; treat as cancel
			this.drag = null;
			this.ctx.setOverlay([]);
			return;
		}
		const prims: OverlayPrim[] = [];
		if (this.drag.kind === "vertex") {
			const { p } = snapMarker(this.ctx, world);
			const e = this.ctx.doc()?.getEntity(this.drag.id);
			if (e) prims.push(...outlineWithVertex(e, this.drag.pairIndex!, p));
			prims.push({ kind: "marker", at: p, style: "square", color: this.ctx.accent, sizePx: 6 });
		} else if (this.drag.kind === "whole" || this.drag.kind === "group") {
			const { dx, dy, target } = this.moveDelta(world, this.drag.basePoint);
			const doc = this.ctx.doc();
			const ids = this.drag.ids ?? [this.drag.id];
			for (const id of ids) {
				const e = doc?.getEntity(id);
				if (e) prims.push(...outlineTranslated(e, dx, dy));
			}
			prims.push({ kind: "marker", at: target, style: "square", color: this.ctx.accent, sizePx: 6 });
		} else {
			const { p, prim } = snapMarker(this.ctx, world);
			prims.push({ kind: "marker", at: p, style: "dot", color: this.ctx.accent, sizePx: 6 });
			if (prim) prims.push(prim);
		}
		this.ctx.setOverlay(prims);
	}

	private onUp(world: Point2): void {
		const d = this.drag;
		this.drag = null;
		if (!d) return;
		if (d.kind === "vertex") {
			const { p } = snapMarker(this.ctx, world);
			const dx = p.x - d.gripOrigin.x;
			const dy = p.y - d.gripOrigin.y;
			if (dx || dy) this.ctx.execute(new MoveVertexCommand(d.id, d.pairIndex!, dx, dy));
		} else if (d.kind === "whole" || d.kind === "group") {
			const { dx, dy } = this.moveDelta(world, d.basePoint);
			if (dx || dy) {
				const ids = d.ids ?? [d.id];
				for (const id of ids) this.ctx.execute(new MoveCommand(id, dx, dy));
			}
		} else {
			const { p } = snapMarker(this.ctx, world);
			const attach = this.ctx.pick(p);
			this.ctx.moveAnnotationTo(d.id, p, attach);
		}
		this.showGrips();
	}

	private showGrips(): void {
		const doc = this.ctx.doc();
		const selId = this.ctx.selectedId();
		if (!doc || !selId || !doc.isEditable(selId)) {
			this.ctx.setOverlay([]);
			return;
		}
		// Grips only make sense for a single selection; a multi-selection just
		// shows nothing and moves as a group.
		if (this.ctx.selectedIds().length > 1) {
			this.ctx.setOverlay([]);
			return;
		}
		const e = doc.getEntity(selId);
		if (!e) return;
		const prims: OverlayPrim[] = gripsOf(e).map((g) => ({
			kind: "marker",
			at: g.point,
			style: g.mode === "vertex" ? "square" : "circle",
			color: this.ctx.accent,
			sizePx: 5,
		}));
		this.ctx.setOverlay(prims);
	}

	deactivate(): void {
		this.drag = null;
		this.ctx.setOverlay([]);
	}

	hint(): string {
		return "Click to select · Ctrl/Cmd+click to add · drag a grip or body to move (snaps) · drag empty space to pan";
	}
}

/** The nearest characteristic point of an entity to a world point, within tol. */
function nearestGrip(e: RenderEntity, world: Point2, tol: number): Point2 | null {
	let best: Point2 | null = null;
	let bestD = tol;
	for (const g of gripsOf(e)) {
		const d = dist(g.point, world);
		if (d <= bestD) {
			bestD = d;
			best = g.point;
		}
	}
	return best;
}

function outlinePoints(e: RenderEntity): Point2[] | null {
	switch (e.type) {
		case "LINE":
			return [e.start, e.end];
		case "LWPOLYLINE":
		case "POLYLINE":
			return e.closed ? [...e.vertices, e.vertices[0]] : e.vertices;
		default:
			return null;
	}
}

function outlineTranslated(e: RenderEntity, dx: number, dy: number): OverlayPrim[] {
	const pts = outlinePoints(e);
	if (pts) return [{ kind: "line", pts: pts.map((p) => ({ x: p.x + dx, y: p.y + dy })), dashed: true }];
	if (e.type === "CIRCLE" || e.type === "ARC")
		return [{ kind: "circle", center: { x: e.center.x + dx, y: e.center.y + dy }, radius: e.radius, dashed: true }];
	if (e.type === "TEXT" || e.type === "MTEXT")
		return [{ kind: "marker", at: { x: e.position.x + dx, y: e.position.y + dy }, style: "square", sizePx: 6 }];
	return [];
}

function outlineWithVertex(e: RenderEntity, pairIndex: number, np: Point2): OverlayPrim[] {
	if (e.type === "LINE") {
		const pts = [pairIndex === 0 ? np : e.start, pairIndex === 1 ? np : e.end];
		return [{ kind: "line", pts, dashed: true }];
	}
	if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
		const pts = e.vertices.map((v, i) => (i === pairIndex ? np : v));
		if (e.closed && pts.length) pts.push(pts[0]);
		return [{ kind: "line", pts, dashed: true }];
	}
	return [];
}

// -- measuring ---------------------------------------------------------------

export class MeasureDistanceTool implements Tool {
	readonly id: ToolId = "measure-distance";
	readonly panWithLeftDrag = false;
	private pts: Point2[] = [];
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			this.pts.push(p);
			if (this.pts.length === 2) {
				const [a, b] = this.pts;
				const dx = b.x - a.x, dy = b.y - a.y;
				this.ctx.reportMeasurement({ kind: "distance", length: Math.hypot(dx, dy), dx, dy, angleDeg: norm360((Math.atan2(dy, dx) * 180) / Math.PI) }, [a, b]);
				// keep the measured segment on screen (and available to "save as annotation")
				this.ctx.setOverlay([
					{ kind: "line", pts: [a, b], color: this.ctx.accent, dashed: true },
					{ kind: "marker", at: a, style: "x", color: this.ctx.accent, sizePx: 4 },
					{ kind: "marker", at: b, style: "x", color: this.ctx.accent, sizePx: 4 },
					{ kind: "label", at: b, text: `${Math.hypot(dx, dy).toFixed(3)} @ ${norm360((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)}°`, color: this.ctx.accent },
				]);
				this.pts = [];
				return;
			}
		}
		if (phase === "move" || phase === "down") {
			const prims: OverlayPrim[] = [];
			if (this.pts.length === 1) {
				const dx = p.x - this.pts[0].x, dy = p.y - this.pts[0].y;
				prims.push({ kind: "line", pts: [this.pts[0], p], color: this.ctx.accent, dashed: true });
				prims.push({ kind: "label", at: p, text: `${Math.hypot(dx, dy).toFixed(3)} @ ${norm360((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)}°`, color: this.ctx.accent });
			}
			if (prim) prims.push(prim);
			this.ctx.setOverlay(prims);
		}
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.pts = [];
		this.ctx.setOverlay([]);
		this.ctx.reportMeasurement(null);
	}
	hint(): string {
		return "Click two points to measure distance · Esc to cancel";
	}
}

export class MeasureRadiusTool implements Tool {
	readonly id: ToolId = "measure-radius";
	readonly panWithLeftDrag = false;
	constructor(private ctx: ToolContext) {}
	pointer(phase: string, world: Point2): void {
		if (phase !== "down") {
			const { prim } = snapMarker(this.ctx, world);
			this.ctx.setOverlay(prim ? [prim] : []);
			return;
		}
		const id = this.ctx.pick(world);
		const e = id ? this.ctx.doc()?.getEntity(id) : undefined;
		if (e && (e.type === "CIRCLE" || e.type === "ARC")) {
			const r = e.radius;
			this.ctx.reportMeasurement({ kind: "radius", radius: r, diameter: r * 2, circumference: 2 * Math.PI * r }, [e.center, { x: e.center.x + r, y: e.center.y }]);
			this.ctx.setOverlay([
				{ kind: "circle", center: e.center, radius: r, color: this.ctx.accent, dashed: true },
				{ kind: "line", pts: [e.center, { x: e.center.x + r, y: e.center.y }], color: this.ctx.accent },
				{ kind: "label", at: { x: e.center.x + r, y: e.center.y }, text: `R ${r.toFixed(3)} · ⌀ ${(r * 2).toFixed(3)}`, color: this.ctx.accent },
			]);
		} else {
			this.ctx.reportMeasurement(null);
			this.ctx.setOverlay([]);
		}
	}
	hint(): string {
		return "Click a circle or arc to read its radius/diameter";
	}
}

export class MeasureAngleTool implements Tool {
	readonly id: ToolId = "measure-angle";
	readonly panWithLeftDrag = false;
	private pts: Point2[] = [];
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.pts = [];
		this.ctx.setOverlay([]);
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			this.pts.push(p);
			if (this.pts.length === 3) {
				const [a, v, b] = this.pts;
				const a1 = Math.atan2(a.y - v.y, a.x - v.x);
				const a2 = Math.atan2(b.y - v.y, b.x - v.x);
				let deg = norm360(((a2 - a1) * 180) / Math.PI);
				if (deg > 180) deg = 360 - deg;
				this.ctx.reportMeasurement({ kind: "angle", angleDeg: deg }, [a, v, b]);
				this.ctx.setOverlay([
					{ kind: "line", pts: [a, v, b], color: this.ctx.accent },
					{ kind: "label", at: v, text: `${deg.toFixed(2)}°`, color: this.ctx.accent },
				]);
				this.pts = [];
				return;
			}
		}
		if (phase === "move" || phase === "down") {
			const prims: OverlayPrim[] = [];
			if (this.pts.length >= 1) prims.push({ kind: "line", pts: [...this.pts, p], color: this.ctx.accent, dashed: true });
			if (prim) prims.push(prim);
			this.ctx.setOverlay(prims);
		}
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.pts = [];
			this.ctx.setOverlay([]);
			this.ctx.reportMeasurement(null);
			return true;
		}
		return false;
	}
	hint(): string {
		return "Click three points (side, vertex, side) to measure an angle";
	}
}

// -- drawing (writes real DXF entities) --------------------------------------

export class DrawLineTool implements Tool {
	readonly id: ToolId = "draw-line";
	readonly panWithLeftDrag = false;
	private start: Point2 | null = null;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			if (!this.start) this.start = p;
			else {
				this.commit(this.start, p);
				this.start = null;
			}
		}
		const prims: OverlayPrim[] = [];
		if (this.start) {
			prims.push({ kind: "line", pts: [this.start, p], color: this.ctx.accent });
			prims.push({ kind: "label", at: p, text: dist(this.start, p).toFixed(3), color: this.ctx.accent });
		}
		if (prim) prims.push(prim);
		this.ctx.setOverlay(prims);
	}
	private commit(a: Point2, b: Point2): void {
		const spec: NewEntitySpec = { type: "LINE", layer: this.ctx.activeLayer(), start: a, end: b };
		const c = this.ctx.activeColor();
		if (c !== null) spec.colorNumber = c;
		this.ctx.execute(new AddEntityCommand(spec));
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.start = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return "Click start and end points · Esc to cancel";
	}
}

export class DrawCircleTool implements Tool {
	readonly id: ToolId = "draw-circle";
	readonly panWithLeftDrag = false;
	private center: Point2 | null = null;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			if (!this.center) this.center = p;
			else {
				const r = dist(this.center, p);
				if (r > 1e-9) {
					const spec: NewEntitySpec = { type: "CIRCLE", layer: this.ctx.activeLayer(), center: this.center, radius: r };
					const c = this.ctx.activeColor();
					if (c !== null) spec.colorNumber = c;
					this.ctx.execute(new AddEntityCommand(spec));
				}
				this.center = null;
			}
		}
		const prims: OverlayPrim[] = [];
		if (this.center) {
			const r = dist(this.center, p);
			prims.push({ kind: "circle", center: this.center, radius: r, color: this.ctx.accent, dashed: true });
			prims.push({ kind: "line", pts: [this.center, p], color: this.ctx.accent });
			prims.push({ kind: "label", at: p, text: `R ${r.toFixed(3)}`, color: this.ctx.accent });
		}
		if (prim) prims.push(prim);
		this.ctx.setOverlay(prims);
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.center = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return "Click centre, then a point on the circle · Esc to cancel";
	}
}

/** Draw a circle from two clicks that are the endpoints of a diameter. */
export class DrawCircle2PTool implements Tool {
	readonly id: ToolId = "draw-circle-2p";
	readonly panWithLeftDrag = false;
	private p1: Point2 | null = null;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			if (!this.p1) this.p1 = p;
			else {
				const center = { x: (this.p1.x + p.x) / 2, y: (this.p1.y + p.y) / 2 };
				const r = dist(this.p1, p) / 2;
				if (r > 1e-9) {
					const spec: NewEntitySpec = { type: "CIRCLE", layer: this.ctx.activeLayer(), center, radius: r };
					const c = this.ctx.activeColor();
					if (c !== null) spec.colorNumber = c;
					this.ctx.execute(new AddEntityCommand(spec));
				}
				this.p1 = null;
			}
		}
		const prims: OverlayPrim[] = [];
		if (this.p1) {
			const center = { x: (this.p1.x + p.x) / 2, y: (this.p1.y + p.y) / 2 };
			const r = dist(this.p1, p) / 2;
			prims.push({ kind: "circle", center, radius: r, color: this.ctx.accent, dashed: true });
			prims.push({ kind: "line", pts: [this.p1, p], color: this.ctx.accent });
			prims.push({ kind: "label", at: p, text: `⌀ ${(r * 2).toFixed(3)}`, color: this.ctx.accent });
		}
		if (prim) prims.push(prim);
		this.ctx.setOverlay(prims);
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.p1 = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return "Click the two ends of a diameter · Esc to cancel";
	}
}

/** Draw a circle through three clicked points (circumcircle). */
export class DrawCircle3PTool implements Tool {
	readonly id: ToolId = "draw-circle-3p";
	readonly panWithLeftDrag = false;
	private pts: Point2[] = [];
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			this.pts.push(p);
			if (this.pts.length === 3) {
				const c = circumcircle(this.pts[0], this.pts[1], this.pts[2]);
				if (c) {
					const spec: NewEntitySpec = { type: "CIRCLE", layer: this.ctx.activeLayer(), center: c.center, radius: c.radius };
					const aci = this.ctx.activeColor();
					if (aci !== null) spec.colorNumber = aci;
					this.ctx.execute(new AddEntityCommand(spec));
				}
				this.reset();
				return;
			}
		}
		const prims: OverlayPrim[] = [];
		for (const pt of this.pts) prims.push({ kind: "marker", at: pt, style: "x", color: this.ctx.accent, sizePx: 4 });
		if (this.pts.length === 2) {
			const c = circumcircle(this.pts[0], this.pts[1], p);
			if (c) prims.push({ kind: "circle", center: c.center, radius: c.radius, color: this.ctx.accent, dashed: true });
		}
		if (prim) prims.push(prim);
		this.ctx.setOverlay(prims);
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.pts = [];
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return "Click three points on the circle · Esc to cancel";
	}
}

/**
 * Draw an arc by centre → start point (sets radius + start angle) → end point
 * (sets end angle). The sweep goes counter-clockwise from start to end, matching
 * DXF arc convention.
 */
export class DrawArcTool implements Tool {
	readonly id: ToolId = "draw-arc";
	readonly panWithLeftDrag = false;
	private center: Point2 | null = null;
	private radius = 0;
	private startAngle = 0;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			if (!this.center) {
				this.center = p;
			} else if (this.radius === 0) {
				this.radius = dist(this.center, p);
				this.startAngle = angleDeg(this.center, p);
			} else {
				const endAngle = angleDeg(this.center, p);
				const spec: NewEntitySpec = { type: "ARC", layer: this.ctx.activeLayer(), center: this.center, radius: this.radius, startAngle: this.startAngle, endAngle };
				const c = this.ctx.activeColor();
				if (c !== null) spec.colorNumber = c;
				this.ctx.execute(new AddEntityCommand(spec));
				this.reset();
				return;
			}
		}
		const prims: OverlayPrim[] = [];
		if (this.center && this.radius === 0) {
			const r = dist(this.center, p);
			prims.push({ kind: "circle", center: this.center, radius: r, color: this.ctx.accent, dashed: true });
			prims.push({ kind: "line", pts: [this.center, p], color: this.ctx.accent });
			prims.push({ kind: "label", at: p, text: `R ${r.toFixed(3)}`, color: this.ctx.accent });
		} else if (this.center) {
			const endAngle = angleDeg(this.center, p);
			prims.push(...arcOutline(this.center, this.radius, this.startAngle, endAngle, this.ctx.accent));
			prims.push({ kind: "line", pts: [this.center, { x: this.center.x + this.radius * Math.cos((endAngle * Math.PI) / 180), y: this.center.y + this.radius * Math.sin((endAngle * Math.PI) / 180) }], color: this.ctx.accent, dashed: true });
			const sweep = norm360(endAngle - this.startAngle);
			prims.push({ kind: "label", at: p, text: `${sweep.toFixed(1)}°`, color: this.ctx.accent });
		}
		if (prim) prims.push(prim);
		this.ctx.setOverlay(prims);
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.center = null;
		this.radius = 0;
		this.startAngle = 0;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return "Click centre, a start point, then an end point (CCW) · Esc to cancel";
	}
}

/** Draw an arc through three clicked points: start, a point it must pass through, and end. */
export class DrawArc3PTool implements Tool {
	readonly id: ToolId = "draw-arc-3p";
	readonly panWithLeftDrag = false;
	private pts: Point2[] = [];
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			this.pts.push(p);
			if (this.pts.length === 3) {
				const spec = arc3PSpec(this.pts[0], this.pts[1], this.pts[2], this.ctx.activeLayer());
				if (spec) {
					const aci = this.ctx.activeColor();
					if (aci !== null) spec.colorNumber = aci;
					this.ctx.execute(new AddEntityCommand(spec));
				}
				this.reset();
				return;
			}
		}
		const prims: OverlayPrim[] = [];
		for (const pt of this.pts) prims.push({ kind: "marker", at: pt, style: "x", color: this.ctx.accent, sizePx: 4 });
		if (this.pts.length === 2) {
			const spec = arc3PSpec(this.pts[0], this.pts[1], p, this.ctx.activeLayer());
			if (spec && spec.type === "ARC") prims.push(...arcOutline(spec.center, spec.radius, spec.startAngle, spec.endAngle, this.ctx.accent));
		}
		if (prim) prims.push(prim);
		this.ctx.setOverlay(prims);
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.pts = [];
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return "Click the start point, a point the arc must pass through, then the end point · Esc to cancel";
	}
}

/** Build a 3-point ARC spec (start, through-point, end), orienting the sweep so it passes through `mid`. */
function arc3PSpec(start: Point2, mid: Point2, end: Point2, layer: string): (NewEntitySpec & { type: "ARC" }) | null {
	const c = circumcircle(start, mid, end);
	if (!c) return null;
	const a0 = angleDeg(c.center, start);
	const a1 = angleDeg(c.center, mid);
	const a2 = angleDeg(c.center, end);
	const [startAngle, endAngle] = angleInArc(a1, a0, a2) ? [a0, a2] : [a2, a0];
	return { type: "ARC", layer, center: c.center, radius: c.radius, startAngle, endAngle };
}

/**
 * Rotate the current selection: click a pivot, then move/click to turn. The angle
 * is measured from the pivot→first-move direction so you can grab and spin.
 */
export class RotateTool implements Tool {
	readonly id: ToolId = "rotate";
	readonly panWithLeftDrag = false;
	private pivot: Point2 | null = null;
	private refAngle: number | null = null;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			if (!this.pivot) {
				this.pivot = p;
				this.refAngle = null;
				this.ctx.setOverlay([{ kind: "marker", at: p, style: "circle", color: this.ctx.accent, sizePx: 7 }]);
				return;
			}
			// second click commits the rotation
			const deg = this.currentAngle(p);
			const ids = this.ctx.selectedIds().filter((id) => this.ctx.doc()?.isEditable(id));
			if (ids.length && Math.abs(deg) > 1e-6) this.ctx.execute(new RotateCommand(ids, this.pivot.x, this.pivot.y, deg));
			this.reset();
			return;
		}
		if (phase === "move" && this.pivot) {
			const deg = this.currentAngle(p);
			const prims: OverlayPrim[] = [
				{ kind: "marker", at: this.pivot, style: "circle", color: this.ctx.accent, sizePx: 7 },
				{ kind: "line", pts: [this.pivot, p], color: this.ctx.accent, dashed: true },
				{ kind: "label", at: p, text: `${deg.toFixed(1)}°`, color: this.ctx.accent },
			];
			const doc = this.ctx.doc();
			for (const id of this.ctx.selectedIds()) {
				const e = doc?.getEntity(id);
				if (e) prims.push(...outlineRotated(e, this.pivot, deg, this.ctx.accent));
			}
			this.ctx.setOverlay(prims);
			return;
		}
		this.ctx.setOverlay(this.pivot ? [{ kind: "marker", at: this.pivot, style: "circle", color: this.ctx.accent, sizePx: 7 }] : prim ? [prim] : []);
	}
	private currentAngle(p: Point2): number {
		if (!this.pivot) return 0;
		const a = angleDeg(this.pivot, p);
		if (this.refAngle === null) this.refAngle = a;
		return norm180(a - this.refAngle);
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.pivot = null;
		this.refAngle = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return "Select entities first · click a pivot, then click to set the rotation angle · Esc to cancel";
	}
}

/**
 * Scale the current selection about a pivot: click a pivot, then move to set
 * the factor (the first move position becomes the 1.0× reference distance),
 * click again to commit. Mirrors RotateTool's interaction shape.
 */
export class ScaleTool implements Tool {
	readonly id: ToolId = "scale";
	readonly panWithLeftDrag = false;
	private pivot: Point2 | null = null;
	private refDist: number | null = null;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			if (!this.pivot) {
				this.pivot = p;
				this.refDist = null;
				this.ctx.setOverlay([{ kind: "marker", at: p, style: "circle", color: this.ctx.accent, sizePx: 7 }]);
				return;
			}
			const factor = this.currentFactor(p);
			const ids = this.ctx.selectedIds().filter((id) => this.ctx.doc()?.isEditable(id));
			if (ids.length && Math.abs(factor - 1) > 1e-6) this.ctx.execute(new ScaleCommand(ids, this.pivot.x, this.pivot.y, factor));
			this.reset();
			return;
		}
		if (phase === "move" && this.pivot) {
			const factor = this.currentFactor(p);
			const prims: OverlayPrim[] = [
				{ kind: "marker", at: this.pivot, style: "circle", color: this.ctx.accent, sizePx: 7 },
				{ kind: "line", pts: [this.pivot, p], color: this.ctx.accent, dashed: true },
				{ kind: "label", at: p, text: `× ${factor.toFixed(3)}`, color: this.ctx.accent },
			];
			const doc = this.ctx.doc();
			for (const id of this.ctx.selectedIds()) {
				const e = doc?.getEntity(id);
				if (e) prims.push(...outlineScaled(e, this.pivot, factor, this.ctx.accent));
			}
			this.ctx.setOverlay(prims);
			return;
		}
		this.ctx.setOverlay(this.pivot ? [{ kind: "marker", at: this.pivot, style: "circle", color: this.ctx.accent, sizePx: 7 }] : prim ? [prim] : []);
	}
	private currentFactor(p: Point2): number {
		if (!this.pivot) return 1;
		const d = dist(this.pivot, p);
		if (this.refDist === null) {
			this.refDist = Math.max(d, 1e-6);
			return 1;
		}
		return d / this.refDist;
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.pivot = null;
		this.refDist = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return "Select entities first · click a pivot, move to set the scale, click to commit · Esc to cancel";
	}
}

/** Mirror the current selection across a line defined by two clicks. */
export class MirrorTool implements Tool {
	readonly id: ToolId = "mirror";
	readonly panWithLeftDrag = false;
	private p1: Point2 | null = null;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			if (!this.p1) {
				this.p1 = p;
			} else {
				const ids = this.ctx.selectedIds().filter((id) => this.ctx.doc()?.isEditable(id));
				if (ids.length && dist(this.p1, p) > 1e-9) this.ctx.execute(new MirrorCommand(ids, this.p1.x, this.p1.y, p.x, p.y));
				this.reset();
				return;
			}
		}
		const prims: OverlayPrim[] = [];
		if (this.p1) {
			prims.push({ kind: "line", pts: [this.p1, p], color: this.ctx.accent, dashed: true });
			const doc = this.ctx.doc();
			for (const id of this.ctx.selectedIds()) {
				const e = doc?.getEntity(id);
				if (e) prims.push(...outlineMirrored(e, this.p1, p, this.ctx.accent));
			}
		}
		if (prim) prims.push(prim);
		this.ctx.setOverlay(prims);
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.p1 = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return "Select entities first · click two points on the mirror line · Esc to cancel";
	}
}

/** Duplicate the current selection: click a base point, then the destination. */
export class CopyTool implements Tool {
	readonly id: ToolId = "copy";
	readonly panWithLeftDrag = false;
	private base: Point2 | null = null;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			if (!this.base) {
				this.base = p;
			} else {
				const dx = p.x - this.base.x, dy = p.y - this.base.y;
				const ids = this.ctx.selectedIds().filter((id) => this.ctx.doc()?.isEditable(id));
				if (ids.length && (dx || dy)) this.ctx.execute(new CopyCommand(ids, dx, dy));
				this.reset();
				return;
			}
		}
		const prims: OverlayPrim[] = [];
		if (this.base) {
			const dx = p.x - this.base.x, dy = p.y - this.base.y;
			const doc = this.ctx.doc();
			for (const id of this.ctx.selectedIds()) {
				const e = doc?.getEntity(id);
				if (e) prims.push(...outlineTranslated(e, dx, dy));
			}
			prims.push({ kind: "line", pts: [this.base, p], color: this.ctx.accent, dashed: true });
			prims.push({ kind: "label", at: p, text: dist(this.base, p).toFixed(3), color: this.ctx.accent });
		}
		if (prim) prims.push(prim);
		this.ctx.setOverlay(prims);
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.base = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return "Select entities first · click a base point, then the destination · Esc to cancel";
	}
}

/** Round a corner between two LINEs: click both, then set a radius. Trims both lines
 * to the tangent points and connects them with an ARC. */
export class FilletTool implements Tool {
	readonly id: ToolId = "fillet";
	readonly panWithLeftDrag = false;
	private first: { id: string; click: Point2 } | null = null;
	private lastRadius = 5;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		if (phase !== "down") return;
		const doc = this.ctx.doc();
		const id = this.ctx.pick(world);
		const e = id ? doc?.getEntity(id) : undefined;
		if (!this.first) {
			if (e && e.type === "LINE" && doc?.isEditable(id!)) {
				this.first = { id: id!, click: world };
				this.ctx.setOverlay([{ kind: "marker", at: world, style: "circle", color: this.ctx.accent, sizePx: 7 }]);
			}
			return;
		}
		if (!e || e.type !== "LINE" || id === this.first.id || !doc?.isEditable(id!)) return;
		const line1 = doc.getEntity(this.first.id) as LineEntity;
		const line2 = e;
		const click1 = this.first.click;
		this.reset();
		void promptNumber(this.ctx, "Fillet radius", this.lastRadius).then((r) => {
			if (r === null || r < 0) return;
			this.lastRadius = r;
			const result = computeFillet(line1, click1, line2, world, r);
			if (!result) return;
			const near1 = result.pair1 === 0 ? line1.start : line1.end;
			const near2 = result.pair2 === 0 ? line2.start : line2.end;
			const cmds: Command[] = [
				new MoveVertexCommand(line1.id, result.pair1, result.point1.x - near1.x, result.point1.y - near1.y),
				new MoveVertexCommand(line2.id, result.pair2, result.point2.x - near2.x, result.point2.y - near2.y),
			];
			if (r > 1e-9) {
				cmds.push(new AddEntityCommand({ type: "ARC", layer: line1.layer, center: result.center, radius: r, startAngle: result.startAngle, endAngle: result.endAngle }));
			}
			this.ctx.execute(new BatchCommand(cmds, "Fillet"));
		});
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.first = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return this.first ? "Click the second line to fillet · Esc to cancel" : "Click the first line to fillet";
	}
}

/** Bevel a corner between two LINEs: click both, then set an equal-distance chamfer. */
export class ChamferTool implements Tool {
	readonly id: ToolId = "chamfer";
	readonly panWithLeftDrag = false;
	private first: { id: string; click: Point2 } | null = null;
	private lastDistance = 5;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		if (phase !== "down") return;
		const doc = this.ctx.doc();
		const id = this.ctx.pick(world);
		const e = id ? doc?.getEntity(id) : undefined;
		if (!this.first) {
			if (e && e.type === "LINE" && doc?.isEditable(id!)) {
				this.first = { id: id!, click: world };
				this.ctx.setOverlay([{ kind: "marker", at: world, style: "circle", color: this.ctx.accent, sizePx: 7 }]);
			}
			return;
		}
		if (!e || e.type !== "LINE" || id === this.first.id || !doc?.isEditable(id!)) return;
		const line1 = doc.getEntity(this.first.id) as LineEntity;
		const line2 = e;
		const click1 = this.first.click;
		this.reset();
		void promptNumber(this.ctx, "Chamfer distance", this.lastDistance).then((d) => {
			if (d === null || d <= 0) return;
			this.lastDistance = d;
			const result = computeChamfer(line1, click1, line2, world, d);
			if (!result) return;
			const near1 = result.pair1 === 0 ? line1.start : line1.end;
			const near2 = result.pair2 === 0 ? line2.start : line2.end;
			const cmds: Command[] = [
				new MoveVertexCommand(line1.id, result.pair1, result.point1.x - near1.x, result.point1.y - near1.y),
				new MoveVertexCommand(line2.id, result.pair2, result.point2.x - near2.x, result.point2.y - near2.y),
				new AddEntityCommand({ type: "LINE", layer: line1.layer, start: result.point1, end: result.point2 }),
			];
			this.ctx.execute(new BatchCommand(cmds, "Chamfer"));
		});
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.first = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return this.first ? "Click the second line to chamfer · Esc to cancel" : "Click the first line to chamfer";
	}
}

/**
 * Trim a LINE or ARC back to where it crosses a cutting edge: click the cutting
 * edge (LINE/CIRCLE/ARC/LWPOLYLINE), then click the excess part of the target to
 * remove. Only trims back to a crossing that lies on the target's current extent.
 */
export class TrimTool implements Tool {
	readonly id: ToolId = "trim";
	readonly panWithLeftDrag = false;
	private edgeId: string | null = null;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		if (phase !== "down") return;
		const doc = this.ctx.doc();
		if (!doc) return;
		if (!this.edgeId) {
			const id = this.ctx.pick(world);
			const e = id ? doc.getEntity(id) : undefined;
			if (e && isCuttingEdgeType(e)) {
				this.edgeId = id;
				this.ctx.setOverlay([{ kind: "marker", at: world, style: "x", color: this.ctx.accent, sizePx: 8 }]);
			}
			return;
		}
		const id = this.ctx.pick(world);
		if (id === this.edgeId) {
			this.reset();
			return;
		}
		const edge = doc.getEntity(this.edgeId);
		const target = id ? doc.getEntity(id) : undefined;
		if (!edge || !target || !id || !doc.isEditable(id)) return;
		if (target.type === "LINE") this.trimLine(target, edge, world);
		else if (target.type === "ARC") this.trimArc(target, edge, world);
	}
	private trimLine(target: LineEntity, edge: RenderEntity, click: Point2): void {
		const nearStart = dist(target.start, click) <= dist(target.end, click);
		const near = nearStart ? target.start : target.end;
		const far = nearStart ? target.end : target.start;
		const point = trimLinePoint(far, near, edge);
		if (!point) return;
		this.ctx.execute(new MoveVertexCommand(target.id, nearStart ? 0 : 1, point.x - near.x, point.y - near.y));
	}
	private trimArc(target: ArcEntity, edge: RenderEntity, click: Point2): void {
		const sPt = { x: target.center.x + target.radius * Math.cos((target.startAngle * Math.PI) / 180), y: target.center.y + target.radius * Math.sin((target.startAngle * Math.PI) / 180) };
		const ePt = { x: target.center.x + target.radius * Math.cos((target.endAngle * Math.PI) / 180), y: target.center.y + target.radius * Math.sin((target.endAngle * Math.PI) / 180) };
		const nearIsEnd = dist(ePt, click) <= dist(sPt, click);
		const angle = trimArcAngle(target.center, target.radius, target.startAngle, target.endAngle, nearIsEnd, edge);
		if (angle === null) return;
		this.ctx.execute(new SetPropsCommand(target.id, nearIsEnd ? { endAngle: angle } : { startAngle: angle }));
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.edgeId = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return this.edgeId ? "Click a LINE or ARC to trim it back to the cutting edge · Esc to pick a new edge" : "Click the cutting edge (LINE, CIRCLE, ARC or polyline)";
	}
}

/**
 * Extend a LINE out to meet a boundary: click the boundary (LINE/CIRCLE/ARC/
 * LWPOLYLINE), then click the end of the line to stretch.
 */
export class ExtendTool implements Tool {
	readonly id: ToolId = "extend";
	readonly panWithLeftDrag = false;
	private edgeId: string | null = null;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		if (phase !== "down") return;
		const doc = this.ctx.doc();
		if (!doc) return;
		if (!this.edgeId) {
			const id = this.ctx.pick(world);
			const e = id ? doc.getEntity(id) : undefined;
			if (e && isCuttingEdgeType(e)) {
				this.edgeId = id;
				this.ctx.setOverlay([{ kind: "marker", at: world, style: "x", color: this.ctx.accent, sizePx: 8 }]);
			}
			return;
		}
		const id = this.ctx.pick(world);
		if (id === this.edgeId) {
			this.reset();
			return;
		}
		const edge = doc.getEntity(this.edgeId);
		const target = id ? doc.getEntity(id) : undefined;
		if (!edge || !target || !id || !doc.isEditable(id) || target.type !== "LINE") return;
		const nearStart = dist(target.start, world) <= dist(target.end, world);
		const near = nearStart ? target.start : target.end;
		const far = nearStart ? target.end : target.start;
		const point = extendLinePoint(far, near, edge);
		if (!point) return;
		this.ctx.execute(new MoveVertexCommand(target.id, nearStart ? 0 : 1, point.x - near.x, point.y - near.y));
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.edgeId = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return this.edgeId ? "Click a LINE end to extend it to the boundary · Esc to pick a new boundary" : "Click the boundary (LINE, CIRCLE, ARC or polyline)";
	}
}

/** Geometry-only offset result (no layer/colour), reused for both preview and commit. */
type OffsetGeom =
	| { type: "LINE"; start: Point2; end: Point2 }
	| { type: "CIRCLE"; center: Point2; radius: number }
	| { type: "ARC"; center: Point2; radius: number; startAngle: number; endAngle: number };

function offsetGeom(e: RenderEntity, toward: Point2): OffsetGeom | null {
	if (e.type === "LINE") {
		const dx = e.end.x - e.start.x, dy = e.end.y - e.start.y;
		const len = Math.hypot(dx, dy);
		if (len < 1e-9) return null;
		let nx = -dy / len, ny = dx / len;
		const side = (toward.x - e.start.x) * nx + (toward.y - e.start.y) * ny;
		if (side < 0) {
			nx = -nx;
			ny = -ny;
		}
		const d = Math.abs(side);
		return { type: "LINE", start: { x: e.start.x + nx * d, y: e.start.y + ny * d }, end: { x: e.end.x + nx * d, y: e.end.y + ny * d } };
	}
	if (e.type === "CIRCLE" || e.type === "ARC") {
		const delta = dist(e.center, toward) - e.radius;
		const newR = e.radius + delta;
		if (newR <= 1e-6) return null;
		return e.type === "CIRCLE"
			? { type: "CIRCLE", center: { ...e.center }, radius: newR }
			: { type: "ARC", center: { ...e.center }, radius: newR, startAngle: e.startAngle, endAngle: e.endAngle };
	}
	return null;
}

function overlayOfOffset(g: OffsetGeom, color: number): OverlayPrim[] {
	if (g.type === "LINE") return [{ kind: "line", pts: [g.start, g.end], color, dashed: true }];
	if (g.type === "CIRCLE") return [{ kind: "circle", center: g.center, radius: g.radius, color, dashed: true }];
	return arcOutline(g.center, g.radius, g.startAngle, g.endAngle, color);
}

/** Offset a LINE, CIRCLE or ARC: click the entity, then click the side/distance for the parallel copy. */
export class OffsetTool implements Tool {
	readonly id: ToolId = "offset";
	readonly panWithLeftDrag = false;
	private source: string | null = null;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const doc = this.ctx.doc();
		if (phase === "down") {
			if (!this.source) {
				const id = this.ctx.pick(world);
				const e = id ? doc?.getEntity(id) : undefined;
				if (e && (e.type === "LINE" || e.type === "CIRCLE" || e.type === "ARC")) this.source = id;
				return;
			}
			const e = doc?.getEntity(this.source);
			if (e) {
				const g = offsetGeom(e, world);
				if (g) {
					const spec: NewEntitySpec = g.type === "LINE"
						? { type: "LINE", layer: e.layer, start: g.start, end: g.end }
						: g.type === "CIRCLE"
							? { type: "CIRCLE", layer: e.layer, center: g.center, radius: g.radius }
							: { type: "ARC", layer: e.layer, center: g.center, radius: g.radius, startAngle: g.startAngle, endAngle: g.endAngle };
					if (e.colorNumber !== undefined) spec.colorNumber = e.colorNumber;
					this.ctx.execute(new AddEntityCommand(spec));
				}
			}
			this.reset();
			return;
		}
		const prims: OverlayPrim[] = [];
		const id = this.source ?? this.ctx.pick(world);
		const e = id ? doc?.getEntity(id) : undefined;
		if (e && (e.type === "LINE" || e.type === "CIRCLE" || e.type === "ARC")) {
			const g = offsetGeom(e, world);
			if (g) prims.push(...overlayOfOffset(g, this.ctx.accent));
		}
		this.ctx.setOverlay(prims);
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.source = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return this.source ? "Click a point to set the offset side/distance · Esc to cancel" : "Click a LINE, CIRCLE or ARC to offset (copy keeps its layer/colour)";
	}
}

/** Rectangular array: prompts for columns/rows/spacing and copies the selection into a grid. */
export class RectArrayTool implements Tool {
	readonly id: ToolId = "array-rect";
	readonly panWithLeftDrag = true;
	constructor(private ctx: ToolContext) {}
	activate(): void {
		void this.run();
	}
	pointer(phase: string): void {
		if (phase === "down") void this.run();
	}
	private async run(): Promise<void> {
		const ids = this.ctx.selectedIds().filter((id) => this.ctx.doc()?.isEditable(id));
		if (!ids.length) return;
		const cols = await promptNumber(this.ctx, "Columns", 3);
		if (!cols || cols < 1) return;
		const rows = await promptNumber(this.ctx, "Rows", 1);
		if (!rows || rows < 1) return;
		const colSpacing = cols > 1 ? await promptNumber(this.ctx, "Column spacing", 10) : 0;
		if (colSpacing === null) return;
		const rowSpacing = rows > 1 ? await promptNumber(this.ctx, "Row spacing", 10) : 0;
		if (rowSpacing === null) return;
		const cmds: Command[] = [];
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				if (r === 0 && c === 0) continue; // original stays in place
				cmds.push(new CopyCommand(ids, c * colSpacing, r * rowSpacing));
			}
		}
		if (cmds.length) this.ctx.execute(new BatchCommand(cmds, "Array (rectangular)"));
	}
	hint(): string {
		return "Select entities, then set columns/rows/spacing in the prompts (click to run again)";
	}
}

/** Polar array: click a centre, then set count/angle and copy the selection around it. */
export class PolarArrayTool implements Tool {
	readonly id: ToolId = "array-polar";
	readonly panWithLeftDrag = false;
	constructor(private ctx: ToolContext) {}
	pointer(phase: string, world: Point2): void {
		if (phase !== "down") {
			const { prim } = snapMarker(this.ctx, world);
			this.ctx.setOverlay(prim ? [prim] : []);
			return;
		}
		const { p } = snapMarker(this.ctx, world);
		void this.run(p);
	}
	private async run(center: Point2): Promise<void> {
		const ids = this.ctx.selectedIds().filter((id) => this.ctx.doc()?.isEditable(id));
		if (!ids.length) return;
		const count = await promptNumber(this.ctx, "Number of copies (including original)", 6);
		if (!count || count < 2) return;
		const totalAngle = await promptNumber(this.ctx, "Total angle (deg, 360 = full circle)", 360);
		if (totalAngle === null) return;
		const full = Math.abs(norm360(totalAngle)) < 1e-6 || Math.abs(totalAngle - 360) < 1e-6;
		const step = totalAngle / (full ? count : count - 1);
		const cmds: Command[] = [];
		for (let k = 1; k < count; k++) cmds.push(new PolarCopyCommand(ids, center.x, center.y, step * k));
		if (cmds.length) this.ctx.execute(new BatchCommand(cmds, "Array (polar)"));
		this.ctx.setOverlay([]);
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.ctx.setOverlay([]);
			return true;
		}
		return false;
	}
	hint(): string {
		return "Select entities first · click the array centre, then set count/angle in the prompts";
	}
}

/** Eyedropper: click a source entity, then click others to copy its layer/colour onto them. */
export class MatchPropertiesTool implements Tool {
	readonly id: ToolId = "match-props";
	readonly panWithLeftDrag = false;
	private source: string | null = null;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		if (phase !== "down") return;
		const doc = this.ctx.doc();
		const id = this.ctx.pick(world);
		if (!id || !doc?.getEntity(id)) return;
		if (!this.source) {
			this.source = id;
			this.ctx.setOverlay([{ kind: "marker", at: world, style: "circle", color: this.ctx.accent, sizePx: 8 }]);
			return;
		}
		if (id === this.source || !doc.isEditable(id)) return;
		const src = doc.getEntity(this.source);
		if (!src) return;
		this.ctx.execute(new BatchCommand([new ChangeLayerCommand(id, src.layer), new ChangeColorCommand(id, src.colorNumber ?? null)], "Match properties"));
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.source = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return this.source ? "Click entities to apply the matched layer/colour · Esc to pick a new source" : "Click the source entity to copy its layer/colour from";
	}
}

export class DrawPolylineTool implements Tool {
	readonly id: ToolId = "draw-polyline";
	readonly panWithLeftDrag = false;
	private pts: Point2[] = [];
	private lastDownTime = 0;
	private lastDownPos: Point2 | null = null;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			const now = Date.now();
			// Double-click (or click near the first vertex) finishes the polyline —
			// no keyboard needed.
			const doubleClick = now - this.lastDownTime < 350 && this.lastDownPos && dist(this.lastDownPos, p) < this.tol();
			if (doubleClick && this.pts.length >= 2) {
				this.finish(false);
				return;
			}
			if (this.pts.length >= 3 && dist(this.pts[0], p) < this.tol()) {
				this.finish(true);
				return;
			}
			this.pts.push(p);
			this.lastDownTime = now;
			this.lastDownPos = p;
		}
		const prims: OverlayPrim[] = [];
		if (this.pts.length) {
			prims.push({ kind: "line", pts: [...this.pts, p], color: this.ctx.accent });
			prims.push({ kind: "marker", at: this.pts[0], style: "square", color: this.ctx.accent, sizePx: 5 });
		}
		if (prim) prims.push(prim);
		this.ctx.setOverlay(prims);
	}
	private tol(): number {
		return this.ctx.pixelSize() * 10;
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Enter") {
			this.finish(false);
			return true;
		}
		if (ev.key.toLowerCase() === "c") {
			this.finish(true);
			return true;
		}
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private finish(closed: boolean): void {
		if (this.pts.length >= 2) {
			const spec: NewEntitySpec = { type: "LWPOLYLINE", layer: this.ctx.activeLayer(), vertices: this.pts.slice(), closed };
			const c = this.ctx.activeColor();
			if (c !== null) spec.colorNumber = c;
			this.ctx.execute(new AddEntityCommand(spec));
		}
		this.reset();
	}
	private reset(): void {
		this.pts = [];
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return "Click to add vertices · double-click or Enter to finish · click first point / C to close · Esc to cancel";
	}
}

/** Two opposite corners define an axis-aligned rectangle, written as a closed LWPOLYLINE. */
function rectVertices(a: Point2, b: Point2): Point2[] {
	return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}

export class DrawRectangleTool implements Tool {
	readonly id: ToolId = "draw-rectangle";
	readonly panWithLeftDrag = false;
	private corner: Point2 | null = null;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") {
			if (!this.corner) this.corner = p;
			else {
				this.commit(this.corner, p);
				this.corner = null;
			}
		}
		const prims: OverlayPrim[] = [];
		if (this.corner) {
			const pts = rectVertices(this.corner, p);
			prims.push({ kind: "line", pts: [...pts, pts[0]], color: this.ctx.accent, dashed: true });
			const w = Math.abs(p.x - this.corner.x), h = Math.abs(p.y - this.corner.y);
			prims.push({ kind: "label", at: p, text: `${w.toFixed(3)} × ${h.toFixed(3)}`, color: this.ctx.accent });
		}
		if (prim) prims.push(prim);
		this.ctx.setOverlay(prims);
	}
	private commit(a: Point2, b: Point2): void {
		if (Math.abs(b.x - a.x) < 1e-9 || Math.abs(b.y - a.y) < 1e-9) return;
		const spec: NewEntitySpec = { type: "LWPOLYLINE", layer: this.ctx.activeLayer(), vertices: rectVertices(a, b), closed: true };
		const c = this.ctx.activeColor();
		if (c !== null) spec.colorNumber = c;
		this.ctx.execute(new AddEntityCommand(spec));
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.corner = null;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return "Click one corner, then the opposite corner · Esc to cancel";
	}
}

function polygonVertices(center: Point2, r: number, angle0Deg: number, sides: number): Point2[] {
	const out: Point2[] = [];
	for (let i = 0; i < sides; i++) {
		const a = ((angle0Deg + (360 * i) / sides) * Math.PI) / 180;
		out.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
	}
	return out;
}

/** Draw a regular polygon: click the centre (prompts for side count), then a vertex point sets radius + rotation. */
export class DrawPolygonTool implements Tool {
	readonly id: ToolId = "draw-polygon";
	readonly panWithLeftDrag = false;
	private center: Point2 | null = null;
	private sides = 6;
	private awaiting = false;
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down" && !this.awaiting) {
			if (!this.center) {
				this.awaiting = true;
				this.center = p;
				void promptNumber(this.ctx, "Number of sides", this.sides).then((n) => {
					this.awaiting = false;
					if (n && n >= 3) this.sides = Math.round(n);
					else this.center = null;
					this.ctx.touch();
				});
				return;
			}
			const r = dist(this.center, p);
			if (r > 1e-9) {
				const vertices = polygonVertices(this.center, r, angleDeg(this.center, p), this.sides);
				const spec: NewEntitySpec = { type: "LWPOLYLINE", layer: this.ctx.activeLayer(), vertices, closed: true };
				const c = this.ctx.activeColor();
				if (c !== null) spec.colorNumber = c;
				this.ctx.execute(new AddEntityCommand(spec));
			}
			this.reset();
			return;
		}
		const prims: OverlayPrim[] = [];
		if (this.center && !this.awaiting) {
			const r = dist(this.center, p);
			const pts = polygonVertices(this.center, r, angleDeg(this.center, p), this.sides);
			prims.push({ kind: "line", pts: [...pts, pts[0]], color: this.ctx.accent, dashed: true });
			prims.push({ kind: "label", at: p, text: `${this.sides}-gon · R ${r.toFixed(3)}`, color: this.ctx.accent });
		}
		if (prim) prims.push(prim);
		this.ctx.setOverlay(prims);
	}
	key(ev: KeyboardEvent): boolean {
		if (ev.key === "Escape") {
			this.reset();
			return true;
		}
		return false;
	}
	private reset(): void {
		this.center = null;
		this.awaiting = false;
		this.ctx.setOverlay([]);
	}
	hint(): string {
		return this.center ? "Click a vertex point to set radius/rotation · Esc to cancel" : "Click the centre (you'll be asked for the number of sides)";
	}
}

export class TextTool implements Tool {
	readonly id: ToolId = "draw-text";
	readonly panWithLeftDrag = false;
	constructor(private ctx: ToolContext) {}
	pointer(phase: string, world: Point2): void {
		if (phase !== "down") {
			const { prim } = snapMarker(this.ctx, world);
			this.ctx.setOverlay(prim ? [prim] : []);
			return;
		}
		const { p } = snapMarker(this.ctx, world);
		void this.ctx.promptText("").then((text) => {
			if (!text) return;
			const spec: NewEntitySpec = { type: "TEXT", layer: this.ctx.activeLayer(), position: p, height: this.ctx.pixelSize() * 16, text };
			const c = this.ctx.activeColor();
			if (c !== null) spec.colorNumber = c;
			this.ctx.execute(new AddEntityCommand(spec));
		});
	}
	hint(): string {
		return "Click a point, then type the text";
	}
}

export class AnnotateTool implements Tool {
	readonly id: ToolId = "annotate";
	readonly panWithLeftDrag = false;
	constructor(private ctx: ToolContext) {}
	pointer(phase: string, world: Point2): void {
		if (phase !== "down") {
			const { prim } = snapMarker(this.ctx, world);
			this.ctx.setOverlay(prim ? [prim] : []);
			return;
		}
		const { p } = snapMarker(this.ctx, world);
		void this.ctx.promptText("").then((text) => {
			if (!text) return;
			this.ctx.addAnnotation({ id: AnnotationStore.newId(), kind: "note", at: p, text });
		});
	}
	hint(): string {
		return "Click a point to drop a note (stored in the sidecar JSON)";
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTools(ctx: ToolContext): Record<ToolId, Tool> {
	return {
		"select": new SelectTool(ctx),
		"measure-distance": new MeasureDistanceTool(ctx),
		"measure-radius": new MeasureRadiusTool(ctx),
		"measure-angle": new MeasureAngleTool(ctx),
		"draw-line": new DrawLineTool(ctx),
		"draw-circle": new DrawCircleTool(ctx),
		"draw-circle-2p": new DrawCircle2PTool(ctx),
		"draw-circle-3p": new DrawCircle3PTool(ctx),
		"draw-arc": new DrawArcTool(ctx),
		"draw-arc-3p": new DrawArc3PTool(ctx),
		"draw-polyline": new DrawPolylineTool(ctx),
		"draw-rectangle": new DrawRectangleTool(ctx),
		"draw-polygon": new DrawPolygonTool(ctx),
		"draw-text": new TextTool(ctx),
		"rotate": new RotateTool(ctx),
		"scale": new ScaleTool(ctx),
		"mirror": new MirrorTool(ctx),
		"copy": new CopyTool(ctx),
		"fillet": new FilletTool(ctx),
		"chamfer": new ChamferTool(ctx),
		"trim": new TrimTool(ctx),
		"extend": new ExtendTool(ctx),
		"offset": new OffsetTool(ctx),
		"array-rect": new RectArrayTool(ctx),
		"array-polar": new PolarArrayTool(ctx),
		"match-props": new MatchPropertiesTool(ctx),
		"annotate": new AnnotateTool(ctx),
	};
}
