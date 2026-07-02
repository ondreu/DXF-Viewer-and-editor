import {
	Scene,
	OrthographicCamera,
	WebGLRenderer,
	BufferGeometry,
	Float32BufferAttribute,
	LineBasicMaterial,
	Line,
	LineLoop,
	Color,
	Object3D,
	Group,
	CanvasTexture,
	MeshBasicMaterial,
	Mesh,
	PlaneGeometry,
	DoubleSide,
} from "three";
import type { DxfDocument } from "../core/model/DxfDocument";
import type { RenderEntity, Point2 } from "../core/model/types";
import { EventEmitter } from "../core/events/EventEmitter";
import { DEFAULT_THEME, type RenderTheme } from "./theme";
import { pickEntity } from "./picking";

export type RendererEvents = {
	select: { id: string | null };
	viewchange: void;
};

interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const PICK_PIXELS = 8;
const ARC_STEPS = 64;

/**
 * Framework-agnostic 2D DXF renderer over three.js (design doc §3). Never
 * imports Svelte; the UI subscribes through `events`. An orthographic camera
 * plus custom pan/zoom keeps the drawing planar.
 */
export class DxfRenderer {
	readonly events = new EventEmitter<RendererEvents>();

	private scene = new Scene();
	private camera: OrthographicCamera;
	private renderer: WebGLRenderer;
	private root = new Group();
	private objects = new Map<string, Object3D>();
	private doc: DxfDocument | null = null;
	private theme: RenderTheme;

	// view state
	private centerX = 0;
	private centerY = 0;
	private unitsPerPixel = 1;
	private selectedId: string | null = null;

	private resizeObserver: ResizeObserver;
	private frameRequested = false;
	private disposed = false;

	constructor(private container: HTMLElement, theme: Partial<RenderTheme> = {}) {
		this.theme = { ...DEFAULT_THEME, ...theme };
		this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setPixelRatio(window.devicePixelRatio || 1);
		this.container.appendChild(this.renderer.domElement);
		this.renderer.domElement.style.width = "100%";
		this.renderer.domElement.style.height = "100%";
		this.renderer.domElement.style.display = "block";
		this.renderer.domElement.style.touchAction = "none";

		this.camera = new OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
		this.scene.add(this.root);
		this.scene.background = new Color(this.theme.background);

		this.resizeObserver = new ResizeObserver(() => this.onResize());
		this.resizeObserver.observe(this.container);

		this.attachInput();
		this.onResize();
	}

	setTheme(theme: Partial<RenderTheme>): void {
		this.theme = { ...this.theme, ...theme };
		this.scene.background = new Color(this.theme.background);
		if (this.doc) this.rebuild();
		this.requestFrame();
	}

	loadDocument(doc: DxfDocument): void {
		this.doc = doc;
		this.rebuild();
		this.fit();
	}

	/** (Re)build all scene objects from the document's live entities. */
	rebuild(): void {
		this.clearObjects();
		if (!this.doc) return;
		for (const e of this.doc.entities) {
			if (this.doc.isDeleted(e.id)) continue;
			const obj = this.buildObject(e);
			if (obj) {
				this.objects.set(e.id, obj);
				this.root.add(obj);
			}
		}
		this.applySelectionHighlight();
		this.requestFrame();
	}

	/** Refresh a single entity after an edit (cheaper than a full rebuild). */
	refreshEntity(id: string): void {
		if (!this.doc) return;
		const old = this.objects.get(id);
		if (old) {
			this.root.remove(old);
			disposeObject(old);
			this.objects.delete(id);
		}
		if (this.doc.isDeleted(id)) {
			this.requestFrame();
			return;
		}
		const e = this.doc.getEntity(id);
		if (e) {
			const obj = this.buildObject(e);
			if (obj) {
				this.objects.set(id, obj);
				this.root.add(obj);
			}
		}
		this.applySelectionHighlight();
		this.requestFrame();
	}

	select(id: string | null, emit = true): void {
		if (this.selectedId === id) return;
		this.selectedId = id;
		this.applySelectionHighlight();
		this.requestFrame();
		if (emit) this.events.emit("select", { id });
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
		const pxW = Math.max(rect.width, 1);
		const pxH = Math.max(rect.height, 1);
		this.unitsPerPixel = Math.max((w / pxW), (h / pxH)) * 1.1;
		this.updateCamera();
		this.requestFrame();
	}

	// -- object construction --------------------------------------------------

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
			case "TEXT":
			case "MTEXT":
				return this.textObject(e.text, e.position, e.height || 1, e.rotation || 0, color);
			case "INSERT": {
				const g = new Group();
				const mat = new LineBasicMaterial({ color });
				for (const [a, b] of e.segments) {
					const geom = new BufferGeometry().setAttribute(
						"position",
						new Float32BufferAttribute([a.x, a.y, 0, b.x, b.y, 0], 3)
					);
					g.add(new Line(geom, mat));
				}
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

	private markerObject(p: Point2, color: number): Object3D {
		const s = 6 * this.unitsPerPixel;
		const arr = [p.x - s, p.y, 0, p.x + s, p.y, 0, p.x, p.y - s, 0, p.x, p.y + s, 0];
		const geom = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(arr, 3));
		return new Line(geom, new LineBasicMaterial({ color }));
	}

	private textObject(text: string, pos: Point2, height: number, rotationDeg: number, color: number): Object3D | null {
		if (!text) return null;
		// UNTRUSTED string: drawn via canvas fillText, never HTML (design doc §5).
		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		const pxHeight = 64;
		ctx.font = `${pxHeight}px sans-serif`;
		const metrics = ctx.measureText(text);
		const pad = 8;
		canvas.width = Math.max(1, Math.ceil(metrics.width) + pad * 2);
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
		// treat pure black/white as "auto" so entities stay visible on any theme
		if (color === 0xffffff || color === 0x000000) return this.theme.foreground;
		return color;
	}

	// -- selection ------------------------------------------------------------

	private applySelectionHighlight(): void {
		for (const [id, obj] of this.objects) {
			const selected = id === this.selectedId;
			obj.traverse((child) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const mat = (child as any).material as LineBasicMaterial | undefined;
				if (mat && "color" in mat) {
					if (selected) {
						mat.color = new Color(this.theme.accent);
					} else {
						const e = this.doc?.getEntity(id);
						if (e) mat.color = new Color(this.resolveColor(e.color));
					}
					mat.needsUpdate = true;
				}
			});
		}
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
			if (!this.disposed) this.renderer.render(this.scene, this.camera);
		});
	}

	// -- input (pan / zoom / pick) --------------------------------------------

	private attachInput(): void {
		const el = this.renderer.domElement;
		let dragging = false;
		let moved = false;
		let lastX = 0;
		let lastY = 0;

		el.addEventListener("pointerdown", (ev) => {
			dragging = true;
			moved = false;
			lastX = ev.clientX;
			lastY = ev.clientY;
			el.setPointerCapture(ev.pointerId);
		});
		el.addEventListener("pointermove", (ev) => {
			if (!dragging) return;
			const dx = ev.clientX - lastX;
			const dy = ev.clientY - lastY;
			if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
			lastX = ev.clientX;
			lastY = ev.clientY;
			this.centerX -= dx * this.unitsPerPixel;
			this.centerY += dy * this.unitsPerPixel;
			this.updateCamera();
			this.requestFrame();
			this.events.emit("viewchange", undefined);
		});
		const endDrag = (ev: PointerEvent) => {
			if (!dragging) return;
			dragging = false;
			try {
				el.releasePointerCapture(ev.pointerId);
			} catch {
				/* ignore */
			}
			if (!moved) this.handlePick(ev);
		};
		el.addEventListener("pointerup", endDrag);
		el.addEventListener("pointercancel", () => (dragging = false));

		el.addEventListener(
			"wheel",
			(ev) => {
				ev.preventDefault();
				const world = this.screenToWorld(ev.clientX, ev.clientY);
				const factor = Math.pow(1.0015, ev.deltaY);
				this.unitsPerPixel *= factor;
				// keep the cursor's world point stationary while zooming
				const after = this.screenToWorld(ev.clientX, ev.clientY);
				this.centerX += world.x - after.x;
				this.centerY += world.y - after.y;
				this.updateCamera();
				this.requestFrame();
				this.events.emit("viewchange", undefined);
			},
			{ passive: false }
		);
	}

	private handlePick(ev: PointerEvent): void {
		if (!this.doc) return;
		const world = this.screenToWorld(ev.clientX, ev.clientY);
		const threshold = PICK_PIXELS * this.unitsPerPixel;
		const id = pickEntity(world, this.doc.entities, threshold, (i) => !!this.doc?.isDeleted(i));
		this.select(id);
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

	private computeBounds(): Bounds | null {
		if (!this.doc) return null;
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		const acc = (p: Point2) => {
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		};
		for (const e of this.doc.entities) {
			if (this.doc.isDeleted(e.id)) continue;
			switch (e.type) {
				case "LINE":
					acc(e.start);
					acc(e.end);
					break;
				case "CIRCLE":
				case "ARC":
					acc({ x: e.center.x - e.radius, y: e.center.y - e.radius });
					acc({ x: e.center.x + e.radius, y: e.center.y + e.radius });
					break;
				case "LWPOLYLINE":
				case "POLYLINE":
					e.vertices.forEach(acc);
					break;
				case "TEXT":
				case "MTEXT":
					acc(e.position);
					break;
				case "INSERT":
					acc(e.position);
					e.segments.forEach(([a, b]) => {
						acc(a);
						acc(b);
					});
					break;
				case "UNSUPPORTED":
					if (e.position) acc(e.position);
					break;
			}
		}
		if (!isFinite(minX)) return null;
		return { minX, minY, maxX, maxY };
	}

	private clearObjects(): void {
		for (const obj of this.objects.values()) {
			this.root.remove(obj);
			disposeObject(obj);
		}
		this.objects.clear();
	}

	dispose(): void {
		this.disposed = true;
		this.resizeObserver.disconnect();
		this.clearObjects();
		this.renderer.dispose();
		this.renderer.domElement.remove();
		this.events.clear();
	}
}

function disposeObject(obj: Object3D): void {
	obj.traverse((child) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const c = child as any;
		if (c.geometry) c.geometry.dispose();
		if (c.material) {
			if (c.material.map) c.material.map.dispose();
			c.material.dispose();
		}
	});
}
