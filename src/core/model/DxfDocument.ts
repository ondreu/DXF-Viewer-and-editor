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
import { serialize, type EntityEdit } from "../serializer/DxfSerializer";
import { entityToTags } from "../serializer/entityTags";
import { fmtReal, nextHandle } from "../serializer/format";

type ColorOverride = number | "BYLAYER" | undefined;

interface EditState {
	offsetX: number;
	offsetY: number;
	layer?: string;
	color: ColorOverride;
}

/**
 * The editable document model over a raw DXF tag stream. Loaded entities patch
 * their original raw tags (verbatim passthrough for anything untouched, §7);
 * newly drawn entities are regenerated from their live render state and injected
 * before the ENTITIES ENDSEC on save (§8 draw tools).
 */
export class DxfDocument {
	readonly entities: RenderEntity[];
	readonly layers: LayerInfo[];

	private readonly byId = new Map<string, RenderEntity>();
	private readonly editState = new Map<string, EditState>();
	private readonly deleted = new Set<string>();
	private readonly added = new Set<string>();
	private readonly layerColor = new Map<string, number>();
	private maxHandle: number;

	constructor(
		private readonly tags: DxfTag[],
		private readonly newline: string,
		private readonly ranges: Record<string, TagRange>,
		entities: RenderEntity[],
		layers: LayerInfo[],
		readonly fullyAddressable: boolean,
		private readonly entitiesEnd: number,
		maxHandle: number
	) {
		this.entities = entities;
		this.layers = layers;
		this.maxHandle = maxHandle;
		for (const e of entities) this.byId.set(e.id, e);
		for (const l of layers) this.layerColor.set(l.name, l.color);
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
			r.maxHandle
		);
	}

	getEntity(id: string): RenderEntity | undefined {
		return this.byId.get(id);
	}

	isEditable(id: string): boolean {
		const e = this.byId.get(id);
		if (!e || this.deleted.has(id)) return false;
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

	hasUnsavedChanges(): boolean {
		return this.buildEdits().size > 0 || this.buildAdditions().length > 0;
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
			case "LWPOLYLINE":
				e = { id: h, type: "LWPOLYLINE", layer: spec.layer, color, colorNumber: spec.colorNumber, vertices: spec.vertices.map((v) => ({ ...v })), closed: spec.closed };
				break;
			case "TEXT":
				e = { id: h, type: "TEXT", layer: spec.layer, color, colorNumber: spec.colorNumber, position: { ...spec.position }, height: spec.height, rotation: 0, text: spec.text };
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

	// -- serialization --------------------------------------------------------

	private buildEdits(): Map<string, EntityEdit> {
		const edits = new Map<string, EntityEdit>();
		for (const id of this.deleted) {
			if (!this.added.has(id)) edits.set(id, null);
		}
		for (const [id, s] of this.editState) {
			if (this.deleted.has(id) || this.added.has(id)) continue;
			if (s.offsetX === 0 && s.offsetY === 0 && s.layer === undefined && s.color === undefined) continue;
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
		for (let i = range.start; i < range.end; i++) {
			const t = this.tags[i];
			let value = t.value;
			if (s.offsetX !== 0 || s.offsetY !== 0) {
				if (t.code >= 10 && t.code <= 19) value = fmtReal(parseFloat(t.value) + s.offsetX);
				else if (t.code >= 20 && t.code <= 29) value = fmtReal(parseFloat(t.value) + s.offsetY);
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
		return out;
	}

	serialize(): string {
		return serialize({
			tags: this.tags,
			newline: this.newline,
			ranges: this.ranges,
			edits: this.buildEdits(),
			additions: this.buildAdditions(),
			additionsAt: this.entitiesEnd,
		});
	}
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

export { fmtReal };
