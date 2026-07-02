import type {
	DxfTag,
	TagRange,
	RenderEntity,
	LayerInfo,
	Point2,
} from "./types";
import { EDITABLE_TYPES } from "./types";
import { aciToRgb } from "./aci";
import { serialize, type EntityEdit } from "../serializer/DxfSerializer";

/** Colour override: a concrete ACI number, "BYLAYER" (remove group 62), or none. */
type ColorOverride = number | "BYLAYER" | undefined;

interface EditState {
	offsetX: number;
	offsetY: number;
	layer?: string;
	color: ColorOverride;
}

/**
 * The editable document model over a raw DXF tag stream.
 *
 * Two representations are kept in lock-step:
 *  - `entities`: the live render model the UI/renderer read.
 *  - per-handle `EditState`: the minimal delta applied to the original raw tags
 *    at save time. Untouched entities contribute nothing, so serialization is a
 *    verbatim passthrough for everything the user didn't edit (design doc §7).
 */
export class DxfDocument {
	readonly entities: RenderEntity[];
	readonly layers: LayerInfo[];

	private readonly byId = new Map<string, RenderEntity>();
	private readonly editState = new Map<string, EditState>();
	private readonly deleted = new Set<string>();
	private readonly layerColor = new Map<string, number>();

	constructor(
		private readonly tags: DxfTag[],
		private readonly newline: string,
		private readonly ranges: Record<string, TagRange>,
		entities: RenderEntity[],
		layers: LayerInfo[],
		readonly fullyAddressable: boolean
	) {
		this.entities = entities;
		this.layers = layers;
		for (const e of entities) this.byId.set(e.id, e);
		for (const l of layers) this.layerColor.set(l.name, l.color);
	}

	getEntity(id: string): RenderEntity | undefined {
		return this.byId.get(id);
	}

	/** Editable = a whitelisted type (§8.2) that carries an addressable handle. */
	isEditable(id: string): boolean {
		const e = this.byId.get(id);
		if (!e || this.deleted.has(id)) return false;
		return EDITABLE_TYPES.has(e.type) && !!this.ranges[id];
	}

	isDeleted(id: string): boolean {
		return this.deleted.has(id);
	}

	hasUnsavedChanges(): boolean {
		return this.buildEdits().size > 0;
	}

	private state(id: string): EditState {
		let s = this.editState.get(id);
		if (!s) {
			s = { offsetX: 0, offsetY: 0, color: undefined };
			this.editState.set(id, s);
		}
		return s;
	}

	// -- mutators (called by commands; all changes go through here) -----------

	move(id: string, dx: number, dy: number): void {
		const e = this.byId.get(id);
		if (!e) return;
		const s = this.state(id);
		s.offsetX += dx;
		s.offsetY += dy;
		translate(e, dx, dy);
	}

	setLayer(id: string, layer: string): void {
		const e = this.byId.get(id);
		if (!e) return;
		this.state(id).layer = layer;
		e.layer = layer;
		if (e.colorNumber === undefined) {
			e.color = this.layerColor.get(layer) ?? 0x000000;
		}
	}

	setColor(id: string, aci: number | null): void {
		const e = this.byId.get(id);
		if (!e) return;
		const s = this.state(id);
		if (aci === null) {
			s.color = "BYLAYER";
			e.colorNumber = undefined;
			e.color = this.layerColor.get(e.layer) ?? 0x000000;
		} else {
			s.color = aci;
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

	/** Read the current layer of an entity (used by commands to capture undo). */
	layerOf(id: string): string {
		return this.byId.get(id)?.layer ?? "0";
	}

	colorOf(id: string): number | null {
		const e = this.byId.get(id);
		return e?.colorNumber ?? null;
	}

	// -- serialization --------------------------------------------------------

	private buildEdits(): Map<string, EntityEdit> {
		const edits = new Map<string, EntityEdit>();
		for (const id of this.deleted) edits.set(id, null);
		for (const [id, s] of this.editState) {
			if (this.deleted.has(id)) continue;
			if (s.offsetX === 0 && s.offsetY === 0 && s.layer === undefined && s.color === undefined) {
				continue;
			}
			const range = this.ranges[id];
			if (!range) continue;
			edits.set(id, this.patchTags(range, s));
		}
		return edits;
	}

	private patchTags(range: TagRange, s: EditState): DxfTag[] {
		const out: DxfTag[] = [];
		let colorApplied = false;
		let layerTagIndex = -1;
		for (let i = range.start; i < range.end; i++) {
			const t = this.tags[i];
			let value = t.value;
			// translate point coordinates: X codes 10-19, Y codes 20-29.
			if ((s.offsetX !== 0 || s.offsetY !== 0)) {
				if (t.code >= 10 && t.code <= 19) value = fmtReal(parseFloat(t.value) + s.offsetX);
				else if (t.code >= 20 && t.code <= 29) value = fmtReal(parseFloat(t.value) + s.offsetY);
			}
			if (t.code === 8 && s.layer !== undefined) value = s.layer;
			if (t.code === 8) layerTagIndex = out.length;
			if (t.code === 62 && s.color !== undefined) {
				if (s.color === "BYLAYER") continue; // drop the tag -> BYLAYER
				value = String(s.color);
				colorApplied = true;
			}
			out.push({ code: t.code, value });
		}
		// Need to *add* a colour tag (entity was BYLAYER, now explicit).
		if (typeof s.color === "number" && !colorApplied) {
			const insertAt = layerTagIndex >= 0 ? layerTagIndex + 1 : 1;
			out.splice(insertAt, 0, { code: 62, value: String(s.color) });
		}
		return out;
	}

	serialize(): string {
		return serialize(this.tags, this.newline, this.ranges, this.buildEdits());
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

/** Format a real for DXF output, avoiding scientific notation (design doc §8.3). */
export function fmtReal(n: number): string {
	if (!isFinite(n)) return "0.0";
	if (Object.is(n, -0)) n = 0;
	let s = n.toFixed(9);
	s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ".0");
	return s;
}
