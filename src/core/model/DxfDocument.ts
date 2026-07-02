import type {
	DxfTag,
	TagRange,
	RenderEntity,
	LayerInfo,
	Point2,
	NewEntitySpec,
} from "./types";
import { EDITABLE_TYPES } from "./types";
import { aciToRgb } from "./aci";
import { serialize, type Replacement, type Insertion } from "../serializer/DxfSerializer";
import { entityToTags } from "../serializer/entityTags";
import { fmtReal, nextHandle } from "../serializer/format";

type ColorOverride = number | "BYLAYER" | undefined;

interface EditState {
	offsetX: number;
	offsetY: number;
	/** per-vertex offsets keyed by coordinate-pair index (for grip dragging) */
	pointOffsets?: Map<number, { dx: number; dy: number }>;
	layer?: string;
	color: ColorOverride;
	/** absolute overrides for scalar group codes (40 radius/height, 50/51 angles, 1 text) */
	codeOverrides?: Map<number, string>;
}

/** Editable fields exposed by the properties panel / precise-edit commands. */
export interface PropPatch {
	radius?: number;
	height?: number;
	rotation?: number;
	text?: string;
	startAngle?: number;
	endAngle?: number;
}

/** Editable fields of a LAYER table entry. */
export interface LayerPatch {
	colorIndex?: number;
	lineType?: string;
	lineWeight?: number;
	visible?: boolean;
	frozen?: boolean;
}

/**
 * The editable document model over a raw DXF tag stream. Loaded entities patch
 * their original raw tags (verbatim passthrough for anything untouched, §7);
 * newly drawn entities are regenerated from their live render state and injected
 * before the ENTITIES ENDSEC on save (§8 draw tools). Layer-table edits patch
 * the LAYER table the same way.
 */
export class DxfDocument {
	readonly entities: RenderEntity[];
	readonly layers: LayerInfo[];

	private readonly byId = new Map<string, RenderEntity>();
	private readonly editState = new Map<string, EditState>();
	private readonly deleted = new Set<string>();
	private readonly added = new Set<string>();
	private readonly layerColor = new Map<string, number>();
	private readonly layerByName = new Map<string, LayerInfo>();
	private readonly layerEdits = new Map<string, LayerPatch>();
	private readonly addedLayers = new Set<string>();
	private maxHandle: number;

	constructor(
		private readonly tags: DxfTag[],
		private readonly newline: string,
		private readonly ranges: Record<string, TagRange>,
		entities: RenderEntity[],
		layers: LayerInfo[],
		readonly fullyAddressable: boolean,
		private readonly entitiesEnd: number,
		maxHandle: number,
		private readonly layerRanges: Record<string, TagRange> = {},
		private readonly layerTableEnd: number = -1
	) {
		this.entities = entities;
		this.layers = layers;
		this.maxHandle = maxHandle;
		for (const e of entities) this.byId.set(e.id, e);
		for (const l of layers) {
			this.layerColor.set(l.name, l.color);
			this.layerByName.set(l.name, l);
		}
	}

	static fromResult(r: import("./types").ParseResult): DxfDocument {
		return new DxfDocument(
			r.tags,
			r.newline,
			r.ranges,
			r.entities,
			r.layers,
			r.fullyAddressable,
			r.entitiesEnd,
			r.maxHandle,
			r.layerRanges,
			r.layerTableEnd
		);
	}

	getEntity(id: string): RenderEntity | undefined {
		return this.byId.get(id);
	}

	isEditable(id: string): boolean {
		const e = this.byId.get(id);
		if (!e || this.deleted.has(id)) return false;
		if (this.isLayerFrozen(e.layer)) return false;
		return EDITABLE_TYPES.has(e.type) && (!!this.ranges[id] || this.added.has(id));
	}

	isDeleted(id: string): boolean {
		return this.deleted.has(id);
	}

	isAdded(id: string): boolean {
		return this.added.has(id);
	}

	layerColorOf(name: string): number {
		return this.layerColor.get(name) ?? 0x000000;
	}

	// -- layer visibility -----------------------------------------------------

	isLayerFrozen(name: string): boolean {
		return this.layerByName.get(name)?.frozen === true;
	}

	isLayerVisible(name: string): boolean {
		const l = this.layerByName.get(name);
		if (!l) return true;
		return l.visible !== false && l.frozen !== true;
	}

	/** True when the entity should be drawn/picked/snapped (not deleted, layer on). */
	isVisible(id: string): boolean {
		if (this.deleted.has(id)) return false;
		const e = this.byId.get(id);
		return !e || this.isLayerVisible(e.layer);
	}

	/** Combined predicate for hidden entities (deleted OR on an off/frozen layer). */
	isHidden(id: string): boolean {
		return !this.isVisible(id);
	}

	hasUnsavedChanges(): boolean {
		return (
			this.buildEntityEdits().size > 0 ||
			this.buildAdditions().length > 0 ||
			this.layerEdits.size > 0 ||
			this.addedLayers.size > 0
		);
	}

	private state(id: string): EditState {
		let s = this.editState.get(id);
		if (!s) {
			s = { offsetX: 0, offsetY: 0, color: undefined };
			this.editState.set(id, s);
		}
		return s;
	}

	// -- creation -------------------------------------------------------------

	/** Create a new entity from a draw spec; returns its handle. */
	addEntity(spec: NewEntitySpec, handle?: string): string {
		let h = handle;
		if (!h) {
			const alloc = nextHandle(this.maxHandle);
			h = alloc.handle;
			this.maxHandle = alloc.next;
		} else {
			const n = parseInt(h, 16);
			if (!Number.isNaN(n) && n > this.maxHandle) this.maxHandle = n;
		}
		const color =
			spec.colorNumber !== undefined ? aciToRgb(spec.colorNumber) : this.layerColorOf(spec.layer);
		let e: RenderEntity;
		switch (spec.type) {
			case "LINE":
				e = { id: h, type: "LINE", layer: spec.layer, color, colorNumber: spec.colorNumber, start: { ...spec.start }, end: { ...spec.end } };
				break;
			case "CIRCLE":
				e = { id: h, type: "CIRCLE", layer: spec.layer, color, colorNumber: spec.colorNumber, center: { ...spec.center }, radius: spec.radius };
				break;
			case "ARC":
				e = { id: h, type: "ARC", layer: spec.layer, color, colorNumber: spec.colorNumber, center: { ...spec.center }, radius: spec.radius, startAngle: spec.startAngle, endAngle: spec.endAngle };
				break;
			case "LWPOLYLINE":
				e = { id: h, type: "LWPOLYLINE", layer: spec.layer, color, colorNumber: spec.colorNumber, vertices: spec.vertices.map((v) => ({ ...v })), closed: spec.closed };
				break;
			case "TEXT":
				e = { id: h, type: "TEXT", layer: spec.layer, color, colorNumber: spec.colorNumber, position: { ...spec.position }, height: spec.height, rotation: spec.rotation ?? 0, text: spec.text };
				break;
		}
		this.entities.push(e);
		this.byId.set(h, e);
		this.added.add(h);
		return h;
	}

	removeAdded(handle: string): void {
		this.added.delete(handle);
		this.byId.delete(handle);
		const i = this.entities.findIndex((e) => e.id === handle);
		if (i >= 0) this.entities.splice(i, 1);
	}

	// -- mutators -------------------------------------------------------------

	move(id: string, dx: number, dy: number): void {
		const e = this.byId.get(id);
		if (!e) return;
		if (!this.added.has(id)) {
			const s = this.state(id);
			s.offsetX += dx;
			s.offsetY += dy;
		}
		translate(e, dx, dy);
	}

	/**
	 * Move a single coordinate pair of an entity (grip drag). `pairIndex` is the
	 * ordinal of the (10/20)-style point within the entity — 0/1 = line
	 * start/end, i = polyline vertex i, 0 = circle/arc centre / text position.
	 */
	moveVertex(id: string, pairIndex: number, dx: number, dy: number): void {
		const e = this.byId.get(id);
		if (!e) return;
		if (!this.added.has(id)) {
			const s = this.state(id);
			if (!s.pointOffsets) s.pointOffsets = new Map();
			const cur = s.pointOffsets.get(pairIndex) ?? { dx: 0, dy: 0 };
			cur.dx += dx;
			cur.dy += dy;
			s.pointOffsets.set(pairIndex, cur);
		}
		const pt = vertexOf(e, pairIndex);
		if (pt) {
			pt.x += dx;
			pt.y += dy;
		}
	}

	/** Move the entity so its anchor lands exactly at (x, y) — precise placement. */
	setAnchor(id: string, x: number, y: number): void {
		const a = this.anchorOf(id);
		if (!a) return;
		this.move(id, x - a.x, y - a.y);
	}

	/** Set scalar properties (radius, text height, angles, text content). */
	setProps(id: string, patch: PropPatch): void {
		const e = this.byId.get(id);
		if (!e) return;
		const override = (code: number, value: string) => {
			if (this.added.has(id)) return; // added entities regenerate from render state
			const s = this.state(id);
			if (!s.codeOverrides) s.codeOverrides = new Map();
			s.codeOverrides.set(code, value);
		};
		if (patch.radius !== undefined && (e.type === "CIRCLE" || e.type === "ARC")) {
			e.radius = patch.radius;
			override(40, fmtReal(patch.radius));
		}
		if (patch.height !== undefined && (e.type === "TEXT" || e.type === "MTEXT")) {
			e.height = patch.height;
			override(40, fmtReal(patch.height));
		}
		if (patch.rotation !== undefined && (e.type === "TEXT" || e.type === "MTEXT")) {
			e.rotation = patch.rotation;
			override(50, fmtReal(patch.rotation));
		}
		if (patch.text !== undefined && (e.type === "TEXT" || e.type === "MTEXT")) {
			e.text = patch.text;
			override(1, patch.text);
		}
		if (patch.startAngle !== undefined && e.type === "ARC") {
			e.startAngle = patch.startAngle;
			override(50, fmtReal(patch.startAngle));
		}
		if (patch.endAngle !== undefined && e.type === "ARC") {
			e.endAngle = patch.endAngle;
			override(51, fmtReal(patch.endAngle));
		}
	}

	/** Read the current value of a scalar prop (for building undo patches). */
	propsOf(id: string): PropPatch {
		const e = this.byId.get(id);
		if (!e) return {};
		switch (e.type) {
			case "CIRCLE":
				return { radius: e.radius };
			case "ARC":
				return { radius: e.radius, startAngle: e.startAngle, endAngle: e.endAngle };
			case "TEXT":
			case "MTEXT":
				return { height: e.height, rotation: e.rotation, text: e.text };
			default:
				return {};
		}
	}

	/** Rotate an entity `deg` degrees CCW about (cx, cy). */
	rotate(id: string, cx: number, cy: number, deg: number): void {
		const e = this.byId.get(id);
		if (!e) return;
		const rad = (deg * Math.PI) / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		const rotate = (p: Point2): { dx: number; dy: number } => {
			const ox = p.x - cx;
			const oy = p.y - cy;
			const nx = cx + ox * cos - oy * sin;
			const ny = cy + ox * sin + oy * cos;
			return { dx: nx - p.x, dy: ny - p.y };
		};
		for (const idx of vertexIndices(e)) {
			const pt = vertexOf(e, idx);
			if (!pt) continue;
			const { dx, dy } = rotate(pt);
			this.moveVertex(id, idx, dx, dy);
		}
		if (e.type === "ARC") {
			this.setProps(id, { startAngle: norm360(e.startAngle + deg), endAngle: norm360(e.endAngle + deg) });
		} else if (e.type === "TEXT" || e.type === "MTEXT") {
			this.setProps(id, { rotation: norm360(e.rotation + deg) });
		}
	}

	/** Scale an entity by `factor` about (cx, cy); also scales radius/text height. */
	scale(id: string, cx: number, cy: number, factor: number): void {
		const e = this.byId.get(id);
		if (!e || !(factor > 0)) return;
		for (const idx of vertexIndices(e)) {
			const pt = vertexOf(e, idx);
			if (!pt) continue;
			const nx = cx + (pt.x - cx) * factor;
			const ny = cy + (pt.y - cy) * factor;
			this.moveVertex(id, idx, nx - pt.x, ny - pt.y);
		}
		if (e.type === "CIRCLE" || e.type === "ARC") {
			this.setProps(id, { radius: e.radius * factor });
		} else if (e.type === "TEXT" || e.type === "MTEXT") {
			this.setProps(id, { height: e.height * factor });
		}
	}

	/** Mirror an entity across the line through (ax, ay)-(bx, by). */
	mirror(id: string, ax: number, ay: number, bx: number, by: number): void {
		const e = this.byId.get(id);
		if (!e) return;
		const lx = bx - ax, ly = by - ay;
		const len2 = lx * lx + ly * ly;
		if (len2 < 1e-12) return;
		const reflect = (p: Point2): { dx: number; dy: number } => {
			const vx = p.x - ax, vy = p.y - ay;
			const t = (vx * lx + vy * ly) / len2;
			const fx = ax + t * lx, fy = ay + t * ly;
			const nx = 2 * fx - p.x, ny = 2 * fy - p.y;
			return { dx: nx - p.x, dy: ny - p.y };
		};
		for (const idx of vertexIndices(e)) {
			const pt = vertexOf(e, idx);
			if (!pt) continue;
			const { dx, dy } = reflect(pt);
			this.moveVertex(id, idx, dx, dy);
		}
		if (e.type === "ARC") {
			// Reflecting reverses the sweep direction, so the new CCW start/end
			// are the mirrored *directions* of the old end/start respectively.
			const theta = (Math.atan2(ly, lx) * 180) / Math.PI;
			const newStart = norm360(2 * theta - e.endAngle);
			const newEnd = norm360(2 * theta - e.startAngle);
			this.setProps(id, { startAngle: newStart, endAngle: newEnd });
		}
	}

	/** Anchor point used to attach annotations to an entity. */
	anchorOf(id: string): Point2 | null {
		const e = this.byId.get(id);
		if (!e) return null;
		switch (e.type) {
			case "LINE":
				return { x: (e.start.x + e.end.x) / 2, y: (e.start.y + e.end.y) / 2 };
			case "CIRCLE":
			case "ARC":
				return { ...e.center };
			case "LWPOLYLINE":
			case "POLYLINE":
				return e.vertices[0] ? { ...e.vertices[0] } : null;
			case "TEXT":
			case "MTEXT":
				return { ...e.position };
			case "INSERT":
				return { ...e.position };
			case "UNSUPPORTED":
				return e.position ? { ...e.position } : null;
		}
	}

	setLayer(id: string, layer: string): void {
		const e = this.byId.get(id);
		if (!e) return;
		if (!this.added.has(id)) this.state(id).layer = layer;
		e.layer = layer;
		if (e.colorNumber === undefined) e.color = this.layerColorOf(layer);
	}

	setColor(id: string, aci: number | null): void {
		const e = this.byId.get(id);
		if (!e) return;
		if (!this.added.has(id)) {
			const s = this.state(id);
			s.color = aci === null ? "BYLAYER" : aci;
		}
		if (aci === null) {
			e.colorNumber = undefined;
			e.color = this.layerColorOf(e.layer);
		} else {
			e.colorNumber = aci;
			e.color = aciToRgb(aci);
		}
	}

	remove(id: string): void {
		this.deleted.add(id);
	}

	restore(id: string): void {
		this.deleted.delete(id);
	}

	layerOf(id: string): string {
		return this.byId.get(id)?.layer ?? "0";
	}

	colorOf(id: string): number | null {
		return this.byId.get(id)?.colorNumber ?? null;
	}

	// -- layer table editing --------------------------------------------------

	/** Create a new layer (drawable immediately; persisted if a LAYER table exists). */
	addLayer(name: string, patch: LayerPatch = {}): void {
		if (this.layerByName.has(name)) {
			this.updateLayer(name, patch);
			return;
		}
		const colorIndex = patch.colorIndex ?? 7;
		const info: LayerInfo = {
			name,
			color: aciToRgb(colorIndex),
			colorIndex,
			visible: patch.visible ?? true,
			frozen: patch.frozen ?? false,
			lineType: patch.lineType ?? "CONTINUOUS",
			lineWeight: patch.lineWeight,
		};
		this.layers.push(info);
		this.layerByName.set(name, info);
		this.layerColor.set(name, info.color);
		this.addedLayers.add(name);
	}

	removeAddedLayer(name: string): void {
		if (!this.addedLayers.has(name)) return;
		this.addedLayers.delete(name);
		this.layerByName.delete(name);
		this.layerColor.delete(name);
		const i = this.layers.findIndex((l) => l.name === name);
		if (i >= 0) this.layers.splice(i, 1);
	}

	updateLayer(name: string, patch: LayerPatch): void {
		const l = this.layerByName.get(name);
		if (!l) return;
		if (patch.colorIndex !== undefined) {
			l.colorIndex = patch.colorIndex;
			l.color = aciToRgb(patch.colorIndex);
			this.layerColor.set(name, l.color);
		}
		if (patch.lineType !== undefined) l.lineType = patch.lineType;
		if (patch.lineWeight !== undefined) l.lineWeight = patch.lineWeight;
		if (patch.visible !== undefined) l.visible = patch.visible;
		if (patch.frozen !== undefined) l.frozen = patch.frozen;
		// Refresh BYLAYER entity colours so a layer recolour is visible immediately.
		if (patch.colorIndex !== undefined) {
			for (const e of this.entities) {
				if (e.layer === name && e.colorNumber === undefined) e.color = l.color;
			}
		}
		if (!this.addedLayers.has(name)) {
			const prev = this.layerEdits.get(name) ?? {};
			this.layerEdits.set(name, { ...prev, ...patch });
		}
	}

	/** Current editable state of a layer (for building undo patches). */
	layerState(name: string): LayerPatch {
		const l = this.layerByName.get(name);
		if (!l) return {};
		return {
			colorIndex: l.colorIndex,
			lineType: l.lineType,
			lineWeight: l.lineWeight,
			visible: l.visible,
			frozen: l.frozen,
		};
	}

	// -- serialization --------------------------------------------------------

	private buildEntityEdits(): Map<string, DxfTag[] | null> {
		const edits = new Map<string, DxfTag[] | null>();
		for (const id of this.deleted) {
			if (!this.added.has(id)) edits.set(id, null);
		}
		for (const [id, s] of this.editState) {
			if (this.deleted.has(id) || this.added.has(id)) continue;
			const hasVertexEdit = !!s.pointOffsets && [...s.pointOffsets.values()].some((v) => v.dx !== 0 || v.dy !== 0);
			const hasCodeEdit = !!s.codeOverrides && s.codeOverrides.size > 0;
			if (s.offsetX === 0 && s.offsetY === 0 && s.layer === undefined && s.color === undefined && !hasVertexEdit && !hasCodeEdit) continue;
			const range = this.ranges[id];
			if (!range) continue;
			edits.set(id, this.patchTags(range, s));
		}
		return edits;
	}

	private buildAdditions(): DxfTag[] {
		const out: DxfTag[] = [];
		for (const id of this.added) {
			if (this.deleted.has(id)) continue;
			const e = this.byId.get(id);
			if (!e) continue;
			const tags = entityToTags(e, id);
			if (tags) out.push(...tags);
		}
		return out;
	}

	private patchTags(range: TagRange, s: EditState): DxfTag[] {
		const out: DxfTag[] = [];
		let colorApplied = false;
		let layerTagIndex = -1;
		const appliedCodes = new Set<number>();
		// Track the coordinate-pair ordinal so per-vertex offsets hit the right
		// point (X code opens a new pair; the matching Y code reuses it).
		let pair = -1;
		for (let i = range.start; i < range.end; i++) {
			const t = this.tags[i];
			let value = t.value;
			if (t.code >= 10 && t.code <= 19) {
				pair++;
				const vo = s.pointOffsets?.get(pair)?.dx ?? 0;
				if (s.offsetX !== 0 || vo !== 0) value = fmtReal(parseFloat(t.value) + s.offsetX + vo);
			} else if (t.code >= 20 && t.code <= 29) {
				const vo = s.pointOffsets?.get(pair)?.dy ?? 0;
				if (s.offsetY !== 0 || vo !== 0) value = fmtReal(parseFloat(t.value) + s.offsetY + vo);
			} else if (s.codeOverrides?.has(t.code) && !appliedCodes.has(t.code)) {
				value = s.codeOverrides.get(t.code)!;
				appliedCodes.add(t.code);
			}
			if (t.code === 8 && s.layer !== undefined) value = s.layer;
			if (t.code === 8) layerTagIndex = out.length;
			if (t.code === 62 && s.color !== undefined) {
				if (s.color === "BYLAYER") continue;
				value = String(s.color);
				colorApplied = true;
			}
			out.push({ code: t.code, value });
		}
		if (typeof s.color === "number" && !colorApplied) {
			const insertAt = layerTagIndex >= 0 ? layerTagIndex + 1 : 1;
			out.splice(insertAt, 0, { code: 62, value: String(s.color) });
		}
		// A code override for a code the entity didn't already carry (e.g. an ARC
		// gaining group 50/51 it lacked) — append it before the next entity.
		if (s.codeOverrides) {
			for (const [code, value] of s.codeOverrides) {
				if (!appliedCodes.has(code)) out.push({ code, value });
			}
		}
		return out;
	}

	private buildLayerEdits(): Map<string, DxfTag[]> {
		const edits = new Map<string, DxfTag[]>();
		for (const [name, patch] of this.layerEdits) {
			const range = this.layerRanges[name];
			if (!range) continue;
			edits.set(name, this.patchLayerTags(range, patch, this.layerByName.get(name)));
		}
		return edits;
	}

	private patchLayerTags(range: TagRange, patch: LayerPatch, info?: LayerInfo): DxfTag[] {
		const colorIndex = patch.colorIndex ?? info?.colorIndex ?? 7;
		const off = patch.visible !== undefined ? !patch.visible : info?.visible === false;
		const frozen = patch.frozen !== undefined ? patch.frozen : info?.frozen === true;
		const out: DxfTag[] = [];
		let has62 = false, has70 = false, has6 = false, has370 = false;
		let insertAfter = -1;
		for (let i = range.start; i < range.end; i++) {
			const t = this.tags[i];
			let value = t.value;
			if (t.code === 2) insertAfter = out.length; // after the name
			if (t.code === 70) {
				has70 = true;
				let flags = parseInt(t.value, 10) || 0;
				flags = frozen ? flags | 1 : flags & ~1;
				value = String(flags);
			} else if (t.code === 62) {
				has62 = true;
				value = String(off ? -Math.abs(colorIndex) : Math.abs(colorIndex));
			} else if (t.code === 6 && patch.lineType !== undefined) {
				has6 = true;
				value = patch.lineType;
			} else if (t.code === 370 && patch.lineWeight !== undefined) {
				has370 = true;
				value = String(patch.lineWeight);
			} else if (t.code === 6) {
				has6 = true;
			} else if (t.code === 370) {
				has370 = true;
			}
			out.push({ code: t.code, value });
		}
		// Insert any codes the original entry lacked, right after the layer name.
		const inserts: DxfTag[] = [];
		if (!has70) inserts.push({ code: 70, value: String(frozen ? 1 : 0) });
		if (!has62) inserts.push({ code: 62, value: String(off ? -Math.abs(colorIndex) : Math.abs(colorIndex)) });
		if (!has6 && patch.lineType !== undefined) inserts.push({ code: 6, value: patch.lineType });
		if (!has370 && patch.lineWeight !== undefined) inserts.push({ code: 370, value: String(patch.lineWeight) });
		if (inserts.length) out.splice(insertAfter >= 0 ? insertAfter + 1 : 1, 0, ...inserts);
		return out;
	}

	private buildLayerAdditions(): DxfTag[] {
		const out: DxfTag[] = [];
		for (const name of this.addedLayers) {
			const l = this.layerByName.get(name);
			if (!l) continue;
			out.push(...layerToTags(l));
		}
		return out;
	}

	serialize(): string {
		const replacements: Replacement[] = [];
		for (const [id, edit] of this.buildEntityEdits()) {
			const range = this.ranges[id];
			if (range) replacements.push({ start: range.start, end: range.end, tags: edit });
		}
		for (const [name, tags] of this.buildLayerEdits()) {
			const range = this.layerRanges[name];
			if (range) replacements.push({ start: range.start, end: range.end, tags });
		}

		const insertions: Insertion[] = [];
		const additions = this.buildAdditions();
		if (this.entitiesEnd >= 0 && additions.length) insertions.push({ at: this.entitiesEnd, tags: additions });
		const layerAdditions = this.buildLayerAdditions();
		if (this.layerTableEnd >= 0 && layerAdditions.length) insertions.push({ at: this.layerTableEnd, tags: layerAdditions });

		return serialize({
			tags: this.tags,
			newline: this.newline,
			replacements,
			insertions,
			entityAdditions: this.entitiesEnd < 0 ? additions : undefined,
		});
	}
}

/** The mutable coordinate pair at a given ordinal, matching patchTags' order. */
function vertexOf(e: RenderEntity, pairIndex: number): Point2 | null {
	switch (e.type) {
		case "LINE":
			return pairIndex === 0 ? e.start : pairIndex === 1 ? e.end : null;
		case "LWPOLYLINE":
		case "POLYLINE":
			return e.vertices[pairIndex] ?? null;
		case "CIRCLE":
		case "ARC":
			return pairIndex === 0 ? e.center : null;
		case "TEXT":
		case "MTEXT":
			return pairIndex === 0 ? e.position : null;
		default:
			return null;
	}
}

/** The set of coordinate-pair ordinals an entity exposes (for rotation). */
function vertexIndices(e: RenderEntity): number[] {
	switch (e.type) {
		case "LINE":
			return [0, 1];
		case "LWPOLYLINE":
		case "POLYLINE":
			return e.vertices.map((_, i) => i);
		case "CIRCLE":
		case "ARC":
		case "TEXT":
		case "MTEXT":
			return [0];
		default:
			return [];
	}
}

function norm360(deg: number): number {
	return ((deg % 360) + 360) % 360;
}

function translate(e: RenderEntity, dx: number, dy: number): void {
	const p = (pt: Point2) => {
		pt.x += dx;
		pt.y += dy;
	};
	switch (e.type) {
		case "LINE":
			p(e.start);
			p(e.end);
			break;
		case "CIRCLE":
		case "ARC":
			p(e.center);
			break;
		case "LWPOLYLINE":
		case "POLYLINE":
			e.vertices.forEach(p);
			break;
		case "TEXT":
		case "MTEXT":
			p(e.position);
			break;
		case "INSERT":
			p(e.position);
			e.segments.forEach(([a, b]) => {
				p(a);
				p(b);
			});
			break;
	}
}

/** Serialize a layer definition to R12-style LAYER table tags. */
function layerToTags(l: LayerInfo): DxfTag[] {
	const colorIndex = l.colorIndex ?? 7;
	const signed = l.visible === false ? -Math.abs(colorIndex) : Math.abs(colorIndex);
	const tags: DxfTag[] = [
		{ code: 0, value: "LAYER" },
		{ code: 2, value: l.name },
		{ code: 70, value: String(l.frozen ? 1 : 0) },
		{ code: 62, value: String(signed) },
		{ code: 6, value: l.lineType ?? "CONTINUOUS" },
	];
	if (l.lineWeight !== undefined) tags.push({ code: 370, value: String(l.lineWeight) });
	return tags;
}

export { fmtReal };
