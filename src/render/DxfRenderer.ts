import {
	Scene,
	OrthographicCamera,
	WebGLRenderer,
	BufferGeometry,
	Float32BufferAttribute,
	LineBasicMaterial,
	LineDashedMaterial,
	Line,
	LineLoop,
	LineSegments,
	Color,
	Object3D,
	Group,
	CanvasTexture,
	MeshBasicMaterial,
	Mesh,
	PlaneGeometry,
	DoubleSide,
	Shape,
	ShapeGeometry,
	Vector2,
} from "three";
import type { DxfDocument } from "../core/model/DxfDocument";
import type { RenderEntity, Point2 } from "../core/model/types";
import { EventEmitter } from "../core/events/EventEmitter";
import { DEFAULT_THEME, type RenderTheme } from "./theme";
import { pickEntity } from "./picking";
import type { Overlay, OverlayPrim } from "./overlay";
import { ellipsePoints } from "../core/geom/geometry2d";

export type RendererEvents = {
	select: { id: string | null };
	viewchange: void;
};

export type PointerPhase = "down" | "move" | "up" | "click";
export interface ToolPointerHandler {
	/** for phase "down" in pan mode, return true to consume (e.g. grabbed a grip) */
	(phase: PointerPhase, world: Point2, ev: PointerEvent): boolean | void;
}

const PICK_PIXELS = 8;
const ARC_STEPS = 64;
const GRID_TARGET_PX = 80;
/** Crossing-select box colour (green, CAD convention) — independent of theme so
 * it reads distinctly from the accent-coloured "window" box in any theme. */
const CROSSING_COLOR = 0x3fb950;

/**
 * Framework-agnostic 2D DXF renderer over three.js (design doc §3). Owns the
 * scene, camera, pan/zoom, an adaptive background grid, an overlay layer for
 * tool feedback, and entity picking. It never imports Svelte or the tools; the
 * tool manager drives it through the public API and pointer handler.
 */
export class DxfRenderer {
	readonly events = new EventEmitter<RendererEvents>();

	private scene = new Scene();
	private camera: OrthographicCamera;
	private renderer: WebGLRenderer;
	private gridGroup = new Group();
	private root = new Group();
	private overlayGroup = new Group();
	private objects = new Map<string, Object3D>();
	private doc: DxfDocument | null = null;
	private theme: RenderTheme;

	private centerX = 0;
	private centerY = 0;
	private unitsPerPixel = 1;
	private selectedId: string | null = null;
	private selection = new Set<string>();

	private gridVisible = true;
	private overlayPrims: Overlay = [];
	private labelCache = new Map<string, CanvasTexture>();

	/** set by the tool manager; left-drag pans when true (select), else tools drive */
	panWithLeftDrag = true;
	private pointerHandler: ToolPointerHandler | null = null;

	private resizeObserver: ResizeObserver;
	private frameRequested = false;
	private disposed = false;

	constructor(private container: HTMLElement, theme: Partial<RenderTheme> = {}) {
		this.theme = { ...DEFAULT_THEME, ...theme };
		// preserveDrawingBuffer lets the screenshot read pixels after compositing.
		this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
		this.renderer.setPixelRatio(window.devicePixelRatio || 1);
		this.container.appendChild(this.renderer.domElement);
		const s = this.renderer.domElement.style;
		s.width = "100%";
		s.height = "100%";
		s.display = "block";
		s.touchAction = "none";

		this.camera = new OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
		this.scene.add(this.gridGroup, this.root, this.overlayGroup);
		this.scene.background = new Color(this.theme.background);

		this.resizeObserver = new ResizeObserver(() => this.onResize());
		this.resizeObserver.observe(this.container);

		this.attachInput();
		this.onResize();
	}

	// -- public API used by the tool manager / view controller ---------------

	get pixelSize(): number {
		return this.unitsPerPixel;
	}

	pixelsToWorld(px: number): number {
		return px * this.unitsPerPixel;
	}

	/** Render synchronously and return a PNG data URL of the current view. */
	snapshot(): string {
		this.rebuildGrid();
		this.renderer.render(this.scene, this.camera);
		return this.renderer.domElement.toDataURL("image/png");
	}

	worldFromClient(clientX: number, clientY: number): Point2 {
		return this.screenToWorld(clientX, clientY);
	}

	setPointerHandler(handler: ToolPointerHandler | null): void {
		this.pointerHandler = handler;
	}

	pickAt(world: Point2): string | null {
		if (!this.doc) return null;
		return pickEntity(world, this.doc.entities, PICK_PIXELS * this.unitsPerPixel, (i) => !!this.doc?.isHidden(i));
	}

	setOverlay(prims: Overlay): void {
		this.overlayPrims = prims;
		this.buildOverlay();
		this.requestFrame();
	}

	setGridVisible(visible: boolean): void {
		this.gridVisible = visible;
		this.gridGroup.visible = visible;
		this.requestFrame();
	}

	setTheme(theme: Partial<RenderTheme>): void {
		this.theme = { ...this.theme, ...theme };
		this.scene.background = new Color(this.theme.background);
		if (this.doc) this.rebuild();
		this.buildOverlay();
		this.requestFrame();
	}

	loadDocument(doc: DxfDocument): void {
		this.doc = doc;
		this.rebuild();
		this.fit();
	}

	rebuild(): void {
		this.clearObjects();
		if (!this.doc) return;
		for (const e of this.doc.entities) {
			if (this.doc.isHidden(e.id)) continue;
			const obj = this.buildObject(e);
			if (obj) {
				this.objects.set(e.id, obj);
				this.root.add(obj);
			}
		}
		this.applySelectionHighlight();
		this.requestFrame();
	}

	refreshEntity(id: string): void {
		if (!this.doc) return;
		const old = this.objects.get(id);
		if (old) {
			this.root.remove(old);
			disposeObject(old);
			this.objects.delete(id);
		}
		if (!this.doc.isHidden(id)) {
			const e = this.doc.getEntity(id);
			if (e) {
				const obj = this.buildObject(e);
				if (obj) {
					this.objects.set(id, obj);
					this.root.add(obj);
				}
			}
		}
		this.applySelectionHighlight();
		this.requestFrame();
	}

	select(id: string | null, emit = true): void {
		this.selectedId = id;
		this.selection = id ? new Set([id]) : new Set();
		this.applySelectionHighlight();
		this.requestFrame();
		if (emit) this.events.emit("select", { id });
	}

	/** Replace the whole selection set (primary = last id), without re-emitting. */
	setSelection(ids: string[]): void {
		this.selection = new Set(ids);
		this.selectedId = ids.length ? ids[ids.length - 1] : null;
		this.applySelectionHighlight();
		this.requestFrame();
	}

	fit(): void {
		if (!this.doc) return;
		const b = this.computeBounds();
		if (!b) return;
		const w = Math.max(b.maxX - b.minX, 1e-6);
		const h = Math.max(b.maxY - b.minY, 1e-6);
		this.centerX = (b.minX + b.maxX) / 2;
		this.centerY = (b.minY + b.maxY) / 2;
		const rect = this.container.getBoundingClientRect();
		this.unitsPerPixel = Math.max(w / Math.max(rect.width, 1), h / Math.max(rect.height, 1)) * 1.1;
		this.updateCamera();
		this.buildOverlay();
		this.requestFrame();
	}

	// -- entity objects -------------------------------------------------------

	private buildObject(e: RenderEntity): Object3D | null {
		const color = this.resolveColor(e.color);
		switch (e.type) {
			case "LINE":
				return this.lineObject([e.start, e.end], color, false);
			case "LWPOLYLINE":
			case "POLYLINE":
				return this.lineObject(e.vertices, color, e.closed);
			case "CIRCLE":
				return this.arcObject(e.center, e.radius, 0, 360, color, true);
			case "ARC":
				return this.arcObject(e.center, e.radius, e.startAngle, e.endAngle, color, false);
			case "ELLIPSE":
				return this.ellipseObject(e.center, e.majorAxisEndpoint, e.ratio, e.startAngle, e.endAngle, color);
			case "TEXT":
			case "MTEXT":
				return this.textObject(e.text, e.position, e.height || 1, e.rotation || 0, color);
			case "INSERT": {
				const g = new Group();
				const mat = new LineBasicMaterial({ color });
				const arr: number[] = [];
				for (const [a, b] of e.segments) arr.push(a.x, a.y, 0, b.x, b.y, 0);
				const geom = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(arr, 3));
				g.add(new LineSegments(geom, mat));
				return g;
			}
			case "UNSUPPORTED":
				return e.position ? this.markerObject(e.position, this.resolveColor(0x888888)) : null;
		}
	}

	private lineObject(pts: Point2[], color: number, closed: boolean): Object3D {
		const arr: number[] = [];
		for (const p of pts) arr.push(p.x, p.y, 0);
		const geom = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(arr, 3));
		const mat = new LineBasicMaterial({ color });
		return closed ? new LineLoop(geom, mat) : new Line(geom, mat);
	}

	private arcObject(c: Point2, r: number, startDeg: number, endDeg: number, color: number, closed: boolean): Object3D {
		const start = (startDeg * Math.PI) / 180;
		let sweep = ((endDeg - startDeg) * Math.PI) / 180;
		if (closed) sweep = Math.PI * 2;
		else if (sweep <= 0) sweep += Math.PI * 2;
		const arr: number[] = [];
		for (let i = 0; i <= ARC_STEPS; i++) {
			const a = start + (sweep * i) / ARC_STEPS;
			arr.push(c.x + r * Math.cos(a), c.y + r * Math.sin(a), 0);
		}
		const geom = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(arr, 3));
		const mat = new LineBasicMaterial({ color });
		return closed ? new LineLoop(geom, mat) : new Line(geom, mat);
	}

	private ellipseObject(center: Point2, majorAxisEndpoint: Point2, ratio: number, startDeg: number, endDeg: number, color: number): Object3D {
		const pts = ellipsePoints(center, majorAxisEndpoint, ratio, startDeg, endDeg, ARC_STEPS);
		const closed = Math.abs(((endDeg - startDeg) % 360 + 360) % 360) < 1e-6;
		const arr: number[] = [];
		for (const p of pts) arr.push(p.x, p.y, 0);
		const geom = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(arr, 3));
		const mat = new LineBasicMaterial({ color });
		return closed ? new LineLoop(geom, mat) : new Line(geom, mat);
	}

	private markerObject(p: Point2, color: number): Object3D {
		const s = 6 * this.unitsPerPixel;
		const arr = [p.x - s, p.y, 0, p.x + s, p.y, 0, p.x, p.y - s, 0, p.x, p.y + s, 0];
		const geom = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(arr, 3));
		return new LineSegments(geom, new LineBasicMaterial({ color }));
	}

	private textObject(text: string, pos: Point2, height: number, rotationDeg: number, color: number): Object3D | null {
		if (!text) return null;
		// UNTRUSTED string: rasterized via canvas, never HTML (design doc §5).
		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		const pxHeight = 64;
		ctx.font = `${pxHeight}px sans-serif`;
		const w = ctx.measureText(text).width;
		const pad = 8;
		canvas.width = Math.max(1, Math.ceil(w) + pad * 2);
		canvas.height = pxHeight + pad * 2;
		const c2 = canvas.getContext("2d")!;
		c2.font = `${pxHeight}px sans-serif`;
		c2.textBaseline = "middle";
		c2.fillStyle = "#" + color.toString(16).padStart(6, "0");
		c2.fillText(text, pad, canvas.height / 2);

		const texture = new CanvasTexture(canvas);
		const worldH = height;
		const worldW = (canvas.width / canvas.height) * worldH;
		const geom = new PlaneGeometry(worldW, worldH);
		const mat = new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide });
		const mesh = new Mesh(geom, mat);
		mesh.position.set(pos.x + worldW / 2, pos.y + worldH / 2, 0);
		if (rotationDeg) mesh.rotation.z = (rotationDeg * Math.PI) / 180;
		return mesh;
	}

	private resolveColor(color: number): number {
		if (color === 0xffffff || color === 0x000000) return this.theme.foreground;
		return color;
	}

	// -- selection ------------------------------------------------------------

	private applySelectionHighlight(): void {
		for (const [id, obj] of this.objects) {
			const selected = this.selection.has(id);
			obj.traverse((child) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const mat = (child as any).material as LineBasicMaterial | undefined;
				if (mat && "color" in mat) {
					if (selected) mat.color = new Color(this.theme.accent);
					else {
						const e = this.doc?.getEntity(id);
						if (e) mat.color = new Color(this.resolveColor(e.color));
					}
					mat.needsUpdate = true;
				}
			});
		}
	}

	// -- grid -----------------------------------------------------------------

	private niceStep(raw: number): number {
		const exp = Math.floor(Math.log10(raw));
		const f = raw / Math.pow(10, exp);
		const nice = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
		return nice * Math.pow(10, exp);
	}

	private rebuildGrid(): void {
		this.clearGroup(this.gridGroup);
		if (!this.gridVisible) return;
		const rect = this.container.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) return;
		const step = this.niceStep(this.unitsPerPixel * GRID_TARGET_PX);
		const major = step * 5;
		const left = this.centerX - (rect.width / 2) * this.unitsPerPixel;
		const right = this.centerX + (rect.width / 2) * this.unitsPerPixel;
		const bottom = this.centerY - (rect.height / 2) * this.unitsPerPixel;
		const top = this.centerY + (rect.height / 2) * this.unitsPerPixel;

		const minor: number[] = [];
		const majorArr: number[] = [];
		const push = (arr: number[], x1: number, y1: number, x2: number, y2: number) =>
			arr.push(x1, y1, 0, x2, y2, 0);
		const maxLines = 600;
		const isMajor = (v: number) => Math.abs(v / major - Math.round(v / major)) < 1e-6;

		let count = 0;
		for (let x = Math.ceil(left / step) * step; x <= right && count < maxLines; x += step, count++) {
			push(isMajor(x) ? majorArr : minor, x, bottom, x, top);
		}
		count = 0;
		for (let y = Math.ceil(bottom / step) * step; y <= top && count < maxLines; y += step, count++) {
			push(isMajor(y) ? majorArr : minor, left, y, right, y);
		}
		// Grid stays subtle but clearly readable against the drawing.
		const gridColor = new Color(this.theme.grid).getHex();
		if (minor.length) this.gridGroup.add(this.segments(minor, gridColor, 0.32));
		if (majorArr.length) this.gridGroup.add(this.segments(majorArr, gridColor, 0.6));
	}

	private segments(arr: number[], color: number, opacity = 1): LineSegments {
		const geom = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(arr, 3));
		const mat = new LineBasicMaterial({ color });
		if (opacity < 1) {
			mat.transparent = true;
			mat.opacity = opacity;
		}
		return new LineSegments(geom, mat);
	}

	// -- overlay --------------------------------------------------------------

	private buildOverlay(): void {
		this.clearGroup(this.overlayGroup, false);
		for (const prim of this.overlayPrims) {
			const obj = this.buildOverlayPrim(prim);
			if (obj) this.overlayGroup.add(obj);
		}
	}

	private buildOverlayPrim(prim: OverlayPrim): Object3D | null {
		const color = "color" in prim ? prim.color ?? this.theme.accent : this.theme.accent;
		switch (prim.kind) {
			case "line": {
				const arr: number[] = [];
				for (const p of prim.pts) arr.push(p.x, p.y, 0);
				const geom = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(arr, 3));
				const mat = prim.dashed
					? new LineDashedMaterial({ color, dashSize: 6 * this.unitsPerPixel, gapSize: 4 * this.unitsPerPixel })
					: new LineBasicMaterial({ color });
				const obj = prim.closed ? new LineLoop(geom, mat) : new Line(geom, mat);
				if (prim.dashed) (obj as Line).computeLineDistances();
				return obj;
			}
			case "circle":
				return this.arcObject(prim.center, prim.radius, 0, 360, color, true);
			case "marker":
				return this.overlayMarker(prim.at, prim.style, color, prim.sizePx ?? 6);
			case "label":
				return this.overlayLabel(prim.at, prim.text, color, prim.background);
			case "rect":
				return this.overlayRect(prim.a, prim.b, prim.mode);
			case "polygon":
				return this.overlayPolygon(prim.pts, color, prim.opacity ?? 0.28);
		}
	}

	private overlayPolygon(pts: Point2[], color: number, opacity: number): Object3D | null {
		if (pts.length < 3) return null;
		const shape = new Shape(pts.map((p) => new Vector2(p.x, p.y)));
		const geom = new ShapeGeometry(shape);
		const mat = new MeshBasicMaterial({ color, transparent: true, opacity, side: DoubleSide, depthTest: false });
		const mesh = new Mesh(geom, mat);
		mesh.position.z = -1;
		return mesh;
	}

	private overlayRect(a: Point2, b: Point2, mode: "window" | "crossing"): Object3D {
		const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
		const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
		const color = mode === "window" ? this.theme.accent : CROSSING_COLOR;
		const group = new Group();

		const w = Math.max(maxX - minX, 1e-6);
		const h = Math.max(maxY - minY, 1e-6);
		const fillGeom = new PlaneGeometry(w, h);
		const fillMat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthTest: false });
		const fill = new Mesh(fillGeom, fillMat);
		fill.position.set((minX + maxX) / 2, (minY + maxY) / 2, -1);
		group.add(fill);

		const pts = [
			{ x: minX, y: minY },
			{ x: maxX, y: minY },
			{ x: maxX, y: maxY },
			{ x: minX, y: maxY },
		];
		const arr: number[] = [];
		for (const p of pts) arr.push(p.x, p.y, 0);
		const geom = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(arr, 3));
		const dashed = mode === "crossing";
		const mat = dashed
			? new LineDashedMaterial({ color, dashSize: 6 * this.unitsPerPixel, gapSize: 4 * this.unitsPerPixel })
			: new LineBasicMaterial({ color });
		const border = new LineLoop(geom, mat);
		if (dashed) border.computeLineDistances();
		group.add(border);
		return group;
	}

	private overlayMarker(at: Point2, style: string, color: number, sizePx: number): Object3D {
		const s = sizePx * this.unitsPerPixel;
		const arr: number[] = [];
		const seg = (x1: number, y1: number, x2: number, y2: number) => arr.push(x1, y1, 0, x2, y2, 0);
		if (style === "square") {
			seg(at.x - s, at.y - s, at.x + s, at.y - s);
			seg(at.x + s, at.y - s, at.x + s, at.y + s);
			seg(at.x + s, at.y + s, at.x - s, at.y + s);
			seg(at.x - s, at.y + s, at.x - s, at.y - s);
		} else if (style === "x") {
			seg(at.x - s, at.y - s, at.x + s, at.y + s);
			seg(at.x - s, at.y + s, at.x + s, at.y - s);
		} else if (style === "diamond") {
			seg(at.x, at.y - s, at.x + s, at.y);
			seg(at.x + s, at.y, at.x, at.y + s);
			seg(at.x, at.y + s, at.x - s, at.y);
			seg(at.x - s, at.y, at.x, at.y - s);
		} else if (style === "triangle") {
			seg(at.x, at.y + s, at.x + s, at.y - s);
			seg(at.x + s, at.y - s, at.x - s, at.y - s);
			seg(at.x - s, at.y - s, at.x, at.y + s);
		} else if (style === "circle" || style === "dot") {
			const steps = 20;
			for (let i = 0; i < steps; i++) {
				const a0 = (i / steps) * Math.PI * 2;
				const a1 = ((i + 1) / steps) * Math.PI * 2;
				seg(at.x + s * Math.cos(a0), at.y + s * Math.sin(a0), at.x + s * Math.cos(a1), at.y + s * Math.sin(a1));
			}
		}
		return this.segments(arr, color);
	}

	private overlayLabel(at: Point2, text: string, color: number, background?: number): Object3D {
		const key = `${text}|${color}|${background ?? ""}`;
		let texture = this.labelCache.get(key);
		let aspect = 1;
		if (!texture) {
			const canvas = document.createElement("canvas");
			const px = 48;
			const ctx = canvas.getContext("2d")!;
			ctx.font = `${px}px sans-serif`;
			const w = ctx.measureText(text).width;
			const pad = 10;
			canvas.width = Math.max(1, Math.ceil(w) + pad * 2);
			canvas.height = px + pad * 2;
			const c2 = canvas.getContext("2d")!;
			if (background !== undefined) {
				c2.fillStyle = "#" + (background & 0xffffff).toString(16).padStart(6, "0");
				c2.fillRect(0, 0, canvas.width, canvas.height);
			}
			c2.font = `${px}px sans-serif`;
			c2.textBaseline = "middle";
			c2.fillStyle = "#" + (color & 0xffffff).toString(16).padStart(6, "0");
			c2.fillText(text, pad, canvas.height / 2);
			texture = new CanvasTexture(canvas);
			this.labelCache.set(key, texture);
		}
		const img = texture.image as HTMLCanvasElement;
		aspect = img.width / img.height;
		const worldH = 16 * this.unitsPerPixel;
		const worldW = aspect * worldH;
		const geom = new PlaneGeometry(worldW, worldH);
		const mat = new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide, depthTest: false });
		const mesh = new Mesh(geom, mat);
		mesh.position.set(at.x + worldW / 2 + 6 * this.unitsPerPixel, at.y + worldH / 2 + 6 * this.unitsPerPixel, 1);
		return mesh;
	}

	// -- camera / rendering ---------------------------------------------------

	private updateCamera(): void {
		const rect = this.container.getBoundingClientRect();
		const halfW = (rect.width / 2) * this.unitsPerPixel;
		const halfH = (rect.height / 2) * this.unitsPerPixel;
		this.camera.left = this.centerX - halfW;
		this.camera.right = this.centerX + halfW;
		this.camera.top = this.centerY + halfH;
		this.camera.bottom = this.centerY - halfH;
		this.camera.updateProjectionMatrix();
	}

	private onResize(): void {
		if (this.disposed) return;
		const rect = this.container.getBoundingClientRect();
		this.renderer.setSize(Math.max(rect.width, 1), Math.max(rect.height, 1), false);
		this.updateCamera();
		this.requestFrame();
	}

	private requestFrame(): void {
		if (this.frameRequested || this.disposed) return;
		this.frameRequested = true;
		requestAnimationFrame(() => {
			this.frameRequested = false;
			if (this.disposed) return;
			this.rebuildGrid();
			this.renderer.render(this.scene, this.camera);
		});
	}

	// -- input ----------------------------------------------------------------

	private attachInput(): void {
		const el = this.renderer.domElement;
		let panning = false;
		let leftMaybeClick = false;
		let moved = false;
		let lastX = 0;
		let lastY = 0;

		// -- two-finger pinch-to-zoom / touch-pan (touch pointers only) --------
		const touchPoints = new Map<number, { x: number; y: number }>();
		let pinching = false;
		let pinchStartDist = 0;
		let pinchStartUnitsPerPixel = 1;
		let pinchStartMidWorld: Point2 = { x: 0, y: 0 };
		const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
			Math.hypot(a.x - b.x, a.y - b.y);
		const beginPinch = () => {
			panning = false;
			leftMaybeClick = false;
			pinching = true;
			const pts = [...touchPoints.values()];
			pinchStartDist = dist(pts[0], pts[1]);
			pinchStartUnitsPerPixel = this.unitsPerPixel;
			const midX = (pts[0].x + pts[1].x) / 2;
			const midY = (pts[0].y + pts[1].y) / 2;
			pinchStartMidWorld = this.screenToWorld(midX, midY);
		};
		const updatePinch = () => {
			const pts = [...touchPoints.values()].slice(0, 2);
			const d = dist(pts[0], pts[1]);
			if (pinchStartDist > 0 && d > 0) {
				this.unitsPerPixel = pinchStartUnitsPerPixel * (pinchStartDist / d);
			}
			const midX = (pts[0].x + pts[1].x) / 2;
			const midY = (pts[0].y + pts[1].y) / 2;
			const after = this.screenToWorld(midX, midY);
			this.centerX += pinchStartMidWorld.x - after.x;
			this.centerY += pinchStartMidWorld.y - after.y;
			this.updateCamera();
			this.buildOverlay(); // pixel-constant sizes changed with zoom
			this.requestFrame();
			this.events.emit("viewchange", undefined);
		};

		el.addEventListener("pointerdown", (ev) => {
			if (ev.pointerType === "touch") {
				touchPoints.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
				if (touchPoints.size === 2) {
					el.setPointerCapture(ev.pointerId);
					beginPinch();
					return;
				}
				if (touchPoints.size > 2) return; // ignore a third+ finger
			}
			lastX = ev.clientX;
			lastY = ev.clientY;
			moved = false;
			el.setPointerCapture(ev.pointerId);
			const secondary = ev.button === 1 || ev.button === 2;
			if (secondary) {
				panning = true;
			} else if (ev.button === 0) {
				if (this.panWithLeftDrag) {
					// Select tool: let it grab a grip; if it doesn't, we pan/click.
					const consumed = this.emitTool("down", ev) === true;
					if (!consumed) {
						panning = true;
						leftMaybeClick = true;
					}
				} else {
					this.emitTool("down", ev);
				}
			}
		});

		el.addEventListener("pointermove", (ev) => {
			if (ev.pointerType === "touch" && touchPoints.has(ev.pointerId)) {
				touchPoints.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
				if (pinching) {
					updatePinch();
					return;
				}
				// single finger down (no pinch yet): fall through to normal pan/tool handling
			}
			const dx = ev.clientX - lastX;
			const dy = ev.clientY - lastY;
			if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
			lastX = ev.clientX;
			lastY = ev.clientY;
			if (panning) {
				this.centerX -= dx * this.unitsPerPixel;
				this.centerY += dy * this.unitsPerPixel;
				this.updateCamera();
				this.requestFrame();
				this.events.emit("viewchange", undefined);
			} else {
				// hover + drag both surface as "move" so tools can preview/snap
				this.emitTool("move", ev);
			}
		});

		const end = (ev: PointerEvent) => {
			try {
				el.releasePointerCapture(ev.pointerId);
			} catch {
				/* ignore */
			}
			if (ev.pointerType === "touch" && touchPoints.has(ev.pointerId)) {
				touchPoints.delete(ev.pointerId);
				if (pinching) {
					if (touchPoints.size < 2) {
						pinching = false;
						const remaining = [...touchPoints.values()][0];
						if (remaining) {
							// one finger still down: resume as a plain single-finger pan
							lastX = remaining.x;
							lastY = remaining.y;
							moved = true;
							panning = true;
							leftMaybeClick = false;
						}
					}
					return;
				}
			}
			if (panning) {
				panning = false;
				if (leftMaybeClick && !moved) this.handleSelectClick(ev);
				leftMaybeClick = false;
			} else if (ev.button === 0) {
				this.emitTool("up", ev);
			}
		};
		el.addEventListener("pointerup", end);
		el.addEventListener("pointercancel", (ev) => {
			touchPoints.delete(ev.pointerId);
			if (touchPoints.size < 2) pinching = false;
			panning = false;
			leftMaybeClick = false;
		});
		el.addEventListener("contextmenu", (ev) => ev.preventDefault());

		el.addEventListener(
			"wheel",
			(ev) => {
				ev.preventDefault();
				const before = this.screenToWorld(ev.clientX, ev.clientY);
				this.unitsPerPixel *= Math.pow(1.0015, ev.deltaY);
				const after = this.screenToWorld(ev.clientX, ev.clientY);
				this.centerX += before.x - after.x;
				this.centerY += before.y - after.y;
				this.updateCamera();
				this.buildOverlay(); // pixel-constant sizes changed with zoom
				this.requestFrame();
				this.events.emit("viewchange", undefined);
			},
			{ passive: false }
		);
	}

	private emitTool(phase: PointerPhase, ev: PointerEvent): boolean {
		if (!this.pointerHandler) return false;
		return this.pointerHandler(phase, this.screenToWorld(ev.clientX, ev.clientY), ev) === true;
	}

	private handleSelectClick(ev: PointerEvent): void {
		const world = this.screenToWorld(ev.clientX, ev.clientY);
		if (this.pointerHandler) {
			this.pointerHandler("click", world, ev);
		} else {
			this.select(this.pickAt(world));
		}
	}

	private screenToWorld(clientX: number, clientY: number): Point2 {
		const rect = this.container.getBoundingClientRect();
		const px = clientX - rect.left;
		const py = clientY - rect.top;
		return {
			x: this.centerX + (px - rect.width / 2) * this.unitsPerPixel,
			y: this.centerY - (py - rect.height / 2) * this.unitsPerPixel,
		};
	}

	// -- bounds / cleanup -----------------------------------------------------

	private computeBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
		if (!this.doc) return null;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		const acc = (p: Point2) => {
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		};
		for (const e of this.doc.entities) {
			if (this.doc.isHidden(e.id)) continue;
			switch (e.type) {
				case "LINE": acc(e.start); acc(e.end); break;
				case "CIRCLE":
				case "ARC":
					acc({ x: e.center.x - e.radius, y: e.center.y - e.radius });
					acc({ x: e.center.x + e.radius, y: e.center.y + e.radius });
					break;
				case "ELLIPSE": {
					// Loose but always-correct bound: a square of the major radius
					// (>= minor radius) centred on the ellipse, regardless of rotation.
					const r = Math.hypot(e.majorAxisEndpoint.x - e.center.x, e.majorAxisEndpoint.y - e.center.y);
					acc({ x: e.center.x - r, y: e.center.y - r });
					acc({ x: e.center.x + r, y: e.center.y + r });
					break;
				}
				case "LWPOLYLINE":
				case "POLYLINE": e.vertices.forEach(acc); break;
				case "TEXT":
				case "MTEXT": acc(e.position); break;
				case "INSERT":
					acc(e.position);
					e.segments.forEach(([a, b]) => { acc(a); acc(b); });
					break;
				case "UNSUPPORTED": if (e.position) acc(e.position); break;
			}
		}
		return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
	}

	private clearObjects(): void {
		for (const obj of this.objects.values()) {
			this.root.remove(obj);
			disposeObject(obj);
		}
		this.objects.clear();
	}

	private clearGroup(group: Group, disposeTextures = true): void {
		for (const child of [...group.children]) {
			group.remove(child);
			disposeObject(child, disposeTextures);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.resizeObserver.disconnect();
		this.clearObjects();
		this.clearGroup(this.gridGroup);
		this.clearGroup(this.overlayGroup);
		for (const t of this.labelCache.values()) t.dispose();
		this.labelCache.clear();
		this.renderer.dispose();
		this.renderer.domElement.remove();
		this.events.clear();
	}
}

function disposeObject(obj: Object3D, disposeTextures = true): void {
	obj.traverse((child) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const c = child as any;
		if (c.geometry) c.geometry.dispose();
		if (c.material) {
			if (disposeTextures && c.material.map) c.material.map.dispose();
			c.material.dispose();
		}
	});
}
