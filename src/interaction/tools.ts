import type { Tool, ToolContext, ToolId } from "./types";
import type { Point2, NewEntitySpec, RenderEntity } from "../core/model/types";
import type { OverlayPrim } from "../render/overlay";
import { AddEntityCommand, MoveCommand, MoveVertexCommand } from "../core/command/commands";
import { AnnotationStore } from "../core/annotation/AnnotationStore";

function snapMarker(ctx: ToolContext, world: Point2): { p: Point2; prim: OverlayPrim | null } {
	const s = ctx.snap(world);
	if (!s) return { p: world, prim: null };
	const style = s.type === "grid" ? "dot" : s.type === "center" ? "circle" : s.type === "midpoint" ? "triangle" : "square";
	return { p: s.point, prim: { kind: "marker", at: s.point, style, color: ctx.accent, sizePx: 7 } };
}

function dist(a: Point2, b: Point2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}
function norm360(deg: number): number {
	return ((deg % 360) + 360) % 360;
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
		kind: "vertex" | "whole" | "annotation";
		id: string;
		pairIndex?: number;
		gripOrigin: Point2;
		cursorStart: Point2;
	} = null;

	constructor(private ctx: ToolContext) {}

	pointer(phase: string, world: Point2, ev?: PointerEvent): boolean | void {
		if (phase === "down") return this.onDown(world);
		if (phase === "move") return this.onMove(world, ev);
		if (phase === "up") return this.onUp(world);
		if (phase === "click") this.ctx.select(this.ctx.pick(world));
	}

	private tol(): number {
		return this.ctx.pixelSize() * 10;
	}

	private onDown(world: Point2): boolean {
		const doc = this.ctx.doc();
		if (!doc) return false;

		// 1. grab a note annotation?
		const annoId = this.ctx.annotationAt(world);
		if (annoId) {
			this.drag = { kind: "annotation", id: annoId, gripOrigin: world, cursorStart: world };
			return true;
		}

		// 2. grab a grip / body of the selected editable entity?
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
					};
					return true;
				}
				if (this.ctx.pick(world) === selId) {
					this.drag = { kind: "whole", id: selId, gripOrigin: world, cursorStart: world };
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
		} else if (this.drag.kind === "whole") {
			const dx = world.x - this.drag.cursorStart.x;
			const dy = world.y - this.drag.cursorStart.y;
			const e = this.ctx.doc()?.getEntity(this.drag.id);
			if (e) prims.push(...outlineTranslated(e, dx, dy));
		} else {
			const at = world;
			prims.push({ kind: "marker", at, style: "dot", color: this.ctx.accent, sizePx: 6 });
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
		} else if (d.kind === "whole") {
			const dx = world.x - d.cursorStart.x;
			const dy = world.y - d.cursorStart.y;
			if (dx || dy) this.ctx.execute(new MoveCommand(d.id, dx, dy));
		} else {
			const attach = this.ctx.pick(world);
			this.ctx.moveAnnotationTo(d.id, world, attach);
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
		return "Click to select · drag a grip/point or body to move · drag empty space to pan";
	}
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
				this.ctx.reportMeasurement({ kind: "distance", length: Math.hypot(dx, dy), dx, dy, angleDeg: norm360((Math.atan2(dy, dx) * 180) / Math.PI) });
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
			this.ctx.reportMeasurement({ kind: "radius", radius: r, diameter: r * 2, circumference: 2 * Math.PI * r });
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
				this.ctx.reportMeasurement({ kind: "angle", angleDeg: deg });
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
		"draw-polyline": new DrawPolylineTool(ctx),
		"draw-text": new TextTool(ctx),
		"annotate": new AnnotateTool(ctx),
	};
}
