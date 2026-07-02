import type { Annotation, AnnotationFile } from "./types";
import type { Overlay, OverlayPrim } from "../../render/overlay";
import type { Point2 } from "../model/types";
import { EventEmitter } from "../events/EventEmitter";

export type AnnotationEvents = { change: void };

/**
 * In-memory annotation model. Pure and Obsidian-free: the view loads/saves the
 * JSON string via the vault, this class only parses, mutates, renders to
 * overlay primitives, and notifies listeners. Stored in a sidecar JSON so the
 * .dxf itself is never touched (design doc / user #4).
 */
export class AnnotationStore {
	readonly events = new EventEmitter<AnnotationEvents>();
	private items: Annotation[] = [];
	private dirty = false;

	get all(): readonly Annotation[] {
		return this.items;
	}

	get isDirty(): boolean {
		return this.dirty;
	}

	loadJSON(text: string | null): void {
		this.items = [];
		this.dirty = false;
		if (!text) {
			this.events.emit("change", undefined);
			return;
		}
		try {
			const parsed = JSON.parse(text) as AnnotationFile;
			if (parsed && Array.isArray(parsed.annotations)) {
				this.items = parsed.annotations.filter((a) => a && typeof a.id === "string");
			}
		} catch {
			// Corrupt sidecar: start empty rather than throwing away the drawing.
			this.items = [];
		}
		this.events.emit("change", undefined);
	}

	toJSON(drawing?: string): string {
		const file: AnnotationFile = { version: 1, drawing, annotations: this.items };
		return JSON.stringify(file, null, 2) + "\n";
	}

	add(a: Annotation): void {
		this.items.push(a);
		this.dirty = true;
		this.events.emit("change", undefined);
	}

	remove(id: string): void {
		const i = this.items.findIndex((a) => a.id === id);
		if (i >= 0) {
			this.items.splice(i, 1);
			this.dirty = true;
			this.events.emit("change", undefined);
		}
	}

	update(id: string, patch: Partial<Annotation>): void {
		const a = this.items.find((x) => x.id === id);
		if (!a) return;
		Object.assign(a, patch);
		this.dirty = true;
		this.events.emit("change", undefined);
	}

	markSaved(): void {
		this.dirty = false;
	}

	static newId(): string {
		return "an-" + Math.random().toString(36).slice(2, 10);
	}

	/** Render all annotations to overlay primitives (persistent overlay layer). */
	toOverlay(color: number): Overlay {
		const prims: OverlayPrim[] = [];
		for (const a of this.items) {
			const c = a.color ?? color;
			switch (a.kind) {
				case "note":
					prims.push({ kind: "marker", at: a.at, style: "dot", color: c, sizePx: 5 });
					prims.push({ kind: "label", at: a.at, text: a.text, color: c });
					break;
				case "arrow":
					prims.push({ kind: "line", pts: [a.from, a.to], color: c });
					pushArrowHead(prims, a.from, a.to, c);
					if (a.text) prims.push({ kind: "label", at: a.to, text: a.text, color: c });
					break;
				case "rect":
					prims.push({
						kind: "line",
						pts: [
							{ x: a.min.x, y: a.min.y },
							{ x: a.max.x, y: a.min.y },
							{ x: a.max.x, y: a.max.y },
							{ x: a.min.x, y: a.max.y },
						],
						color: c,
						closed: true,
					});
					if (a.text) prims.push({ kind: "label", at: a.max, text: a.text, color: c });
					break;
				case "measure":
					if (a.points.length >= 2) {
						prims.push({ kind: "line", pts: a.points, color: c, dashed: true });
						for (const p of a.points) prims.push({ kind: "marker", at: p, style: "x", color: c, sizePx: 4 });
					}
					prims.push({ kind: "label", at: a.points[a.points.length - 1] ?? { x: 0, y: 0 }, text: measureLabel(a.data), color: c });
					break;
			}
		}
		return prims;
	}
}

function measureLabel(d: import("./types").MeasureData): string {
	if (d.kind === "distance") return `${d.length.toFixed(3)} @ ${d.angleDeg.toFixed(1)}°`;
	if (d.kind === "radius") return `R ${d.radius.toFixed(3)} · ⌀ ${d.diameter.toFixed(3)}`;
	if (d.kind === "area") return `A ${d.area.toFixed(3)} · P ${d.perimeter.toFixed(3)}`;
	if (d.kind === "point") return `(${d.x.toFixed(3)}, ${d.y.toFixed(3)})`;
	return `${d.angleDeg.toFixed(2)}°`;
}

function pushArrowHead(prims: OverlayPrim[], from: Point2, to: Point2, color: number): void {
	const ang = Math.atan2(to.y - from.y, to.x - from.x);
	const len = Math.hypot(to.x - from.x, to.y - from.y);
	const h = Math.min(len * 0.2, 1);
	const a1 = ang + Math.PI - 0.4;
	const a2 = ang + Math.PI + 0.4;
	prims.push({ kind: "line", pts: [to, { x: to.x + h * Math.cos(a1), y: to.y + h * Math.sin(a1) }], color });
	prims.push({ kind: "line", pts: [to, { x: to.x + h * Math.cos(a2), y: to.y + h * Math.sin(a2) }], color });
}
