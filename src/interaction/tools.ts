import type { Tool, ToolContext, ToolId } from "./types";
import type { Point2, NewEntitySpec } from "../core/model/types";
import type { OverlayPrim } from "../render/overlay";
import { AddEntityCommand } from "../core/command/commands";
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

export class SelectTool implements Tool {
	readonly id: ToolId = "select";
	readonly panWithLeftDrag = true;
	constructor(private ctx: ToolContext) {}
	pointer(phase: string, world: Point2): void {
		if (phase === "click") this.ctx.select(this.ctx.pick(world));
	}
	hint(): string {
		return "Click to select · drag to pan · scroll to zoom";
	}
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
	constructor(private ctx: ToolContext) {}
	deactivate(): void {
		this.reset();
	}
	pointer(phase: string, world: Point2): void {
		const { p, prim } = snapMarker(this.ctx, world);
		if (phase === "down") this.pts.push(p);
		const prims: OverlayPrim[] = [];
		if (this.pts.length) {
			prims.push({ kind: "line", pts: [...this.pts, p], color: this.ctx.accent });
		}
		if (prim) prims.push(prim);
		this.ctx.setOverlay(prims);
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
		return "Click to add vertices · Enter to finish · C to close · Esc to cancel";
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
