import type { IDxf, IBlock } from "dxf-parser";
import type {
	RenderEntity,
	LayerInfo,
	Point2,
	TagRange,
	DxfTag,
} from "../model/types";
import { aciToRgb } from "../model/aci";
import { ocsToWorld, isDefaultNormal, WCS_NORMAL, type Vec3 } from "./ocs";

const DEFAULT_COLOR = 0x000000;
const ARC_SEGMENTS = 64;
const MAX_INSERT_DEPTH = 8;
const MAX_ARRAY = 400;

/**
 * Build the renderer's semantic model from dxf-parser output, plus surface any
 * entities dxf-parser dropped as UNSUPPORTED placeholders. Two correctness
 * concerns handled here (bug #5): OCS/extrusion transforms — which dxf-parser
 * does not read for CIRCLE — and recursive/array block INSERTs.
 */
export function buildRenderModel(
	dxf: IDxf,
	tags: DxfTag[],
	ranges: Record<string, TagRange>,
	layerRanges: Record<string, TagRange> = {}
): { entities: RenderEntity[]; layers: LayerInfo[] } {
	const layerMap = dxf.tables?.layer?.layers ?? {};
	const layers: LayerInfo[] = Object.values(layerMap).map((l) => {
		const raw = layerRanges[l.name] ? readLayerTags(tags, layerRanges[l.name]) : {};
		return {
			name: l.name,
			color: l.color ?? DEFAULT_COLOR,
			colorIndex: raw.colorRaw !== undefined ? Math.abs(raw.colorRaw) : undefined,
			// group 62 negative = layer off; group 70 bit 1 = frozen.
			visible: raw.colorRaw !== undefined ? raw.colorRaw >= 0 : l.visible !== false,
			frozen: raw.flags !== undefined ? (raw.flags & 1) !== 0 : false,
			lineType: raw.lineType,
			lineWeight: raw.lineWeight,
		};
	});
	const layerColor = (name: string): number =>
		layerMap[name]?.color ?? DEFAULT_COLOR;

	const resolveColor = (e: {
		color?: number;
		colorIndex?: number;
		layer?: string;
	}): { color: number; colorNumber?: number } => {
		if (typeof e.colorIndex === "number" && e.colorIndex !== 256) {
			const rgb = typeof e.color === "number" ? e.color : aciToRgb(e.colorIndex);
			return { color: rgb, colorNumber: e.colorIndex };
		}
		return { color: layerColor(e.layer ?? "0") };
	};

	const entities: RenderEntity[] = [];
	const seenHandles = new Set<string>();

	for (const e of dxf.entities ?? []) {
		const handle = e.handle != null ? String(e.handle) : "";
		if (handle) seenHandles.add(handle);
		// Extrusion for CIRCLE/ARC/LWPOLYLINE/TEXT is read from raw tags because
		// dxf-parser omits it for several of these types.
		const normal = handle && ranges[handle] ? readExtrusion(tags, ranges[handle]) : WCS_NORMAL;
		const built = buildEntity(e, handle, normal, resolveColor, dxf.blocks ?? {});
		if (built) entities.push(built);
	}

	for (const [handle, range] of Object.entries(ranges)) {
		if (seenHandles.has(handle)) continue;
		entities.push({
			id: handle,
			type: "UNSUPPORTED",
			dxfType: tags[range.start]?.value ?? "?",
			layer: readLayer(tags, range),
			color: 0x888888,
			position: readFirstPoint(tags, range),
		});
	}

	return { entities, layers };
}

function buildEntity(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	e: any,
	handle: string,
	normal: Vec3,
	resolveColor: (e: {
		color?: number;
		colorIndex?: number;
		layer?: string;
	}) => { color: number; colorNumber?: number },
	blocks: Record<string, IBlock>
): RenderEntity | null {
	const { color, colorNumber } = resolveColor(e);
	const layer: string = e.layer ?? "0";
	const base = { id: handle, layer, color, colorNumber };
	// For OCS entities, map their stored points into world coordinates.
	const w = (p: { x?: number; y?: number; z?: number }): Point2 =>
		ocsToWorld({ x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0 }, normal);

	switch (e.type) {
		case "LINE": {
			// LINE endpoints are always WCS — no OCS transform.
			const [a, b] = e.vertices ?? [];
			if (!a || !b) return null;
			return { ...base, type: "LINE", start: xy(a), end: xy(b) };
		}
		case "CIRCLE":
			if (!e.center) return null;
			return { ...base, type: "CIRCLE", center: w(e.center), radius: e.radius };
		case "ARC": {
			if (!e.center) return null;
			const center = w(e.center);
			let startAngle = radToDeg(e.startAngle ?? 0);
			let endAngle = radToDeg(e.endAngle ?? 0);
			// A mirrored OCS reverses arc sweep direction.
			if (!isDefaultNormal(normal) && normal.z < 0) {
				[startAngle, endAngle] = [180 - endAngle, 180 - startAngle];
			}
			return { ...base, type: "ARC", center, radius: e.radius, startAngle, endAngle };
		}
		case "LWPOLYLINE":
		case "POLYLINE": {
			const elevation = e.elevation ?? 0;
			const vertices = (e.vertices ?? []).map((v: { x?: number; y?: number }) =>
				w({ x: v.x, y: v.y, z: elevation })
			);
			if (vertices.length < 2) return null;
			return { ...base, type: e.type, vertices, closed: !!e.shape };
		}
		case "TEXT":
			return {
				...base,
				type: "TEXT",
				position: w(e.startPoint ?? { x: 0, y: 0 }),
				height: e.textHeight ?? 1,
				rotation: e.rotation ?? 0,
				text: String(e.text ?? ""),
			};
		case "MTEXT":
			// MTEXT insertion point is WCS.
			return {
				...base,
				type: "MTEXT",
				position: xy(e.position ?? { x: 0, y: 0 }),
				height: e.height ?? 1,
				rotation: e.rotation ?? 0,
				text: String(e.text ?? ""),
			};
		case "INSERT": {
			const segments: Array<[Point2, Point2]> = [];
			flattenInsert(e, blocks, identityTx, 0, segments, normal);
			return {
				...base,
				type: "INSERT",
				position: w(e.position ?? { x: 0, y: 0 }),
				segments,
			};
		}
		default:
			return {
				...base,
				type: "UNSUPPORTED",
				dxfType: String(e.type ?? "?"),
				color: 0x888888,
			};
	}
}

// -- INSERT flattening (recursive + array), design doc §8.1 -----------------

type Tx = (p: { x: number; y: number }) => Point2;

const identityTx: Tx = (p) => ({ x: p.x, y: p.y });

function composeInsertTx(
	insert: { position?: Point2; rotation?: number; xScale?: number; yScale?: number },
	block: IBlock | undefined,
	parent: Tx
): Tx {
	const ox = insert.position?.x ?? 0;
	const oy = insert.position?.y ?? 0;
	const sx = insert.xScale ?? 1;
	const sy = insert.yScale ?? 1;
	const rot = ((insert.rotation ?? 0) * Math.PI) / 180;
	const cos = Math.cos(rot);
	const sin = Math.sin(rot);
	const bx = block?.position?.x ?? 0;
	const by = block?.position?.y ?? 0;
	return (p) => {
		const lx = (p.x - bx) * sx;
		const ly = (p.y - by) * sy;
		return parent({ x: ox + lx * cos - ly * sin, y: oy + lx * sin + ly * cos });
	};
}

function flattenInsert(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	insert: any,
	blocks: Record<string, IBlock>,
	parent: Tx,
	depth: number,
	out: Array<[Point2, Point2]>,
	topNormal: Vec3
): void {
	if (depth > MAX_INSERT_DEPTH) return;
	const block = insert.name ? blocks[insert.name] : undefined;
	if (!block) return;

	// Array (MINSERT) expansion.
	const cols = Math.max(1, Math.min(insert.columnCount ?? 1, MAX_ARRAY));
	const rows = Math.max(1, Math.min(insert.rowCount ?? 1, MAX_ARRAY));
	const cs = insert.columnSpacing ?? 0;
	const rs = insert.rowSpacing ?? 0;

	for (let c = 0; c < cols; c++) {
		for (let r = 0; r < rows; r++) {
			const cell = {
				...insert,
				position: {
					x: (insert.position?.x ?? 0) + c * cs,
					y: (insert.position?.y ?? 0) + r * rs,
				},
				columnCount: 1,
				rowCount: 1,
			};
			// Apply OCS only at the top-level insert.
			const ocsParent: Tx =
				depth === 0 && !isDefaultNormal(topNormal)
					? (p) => ocsToWorld({ x: p.x, y: p.y, z: 0 }, topNormal)
					: parent;
			const tx = composeInsertTx(cell, block, ocsParent);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			for (const be of (block.entities ?? []) as any[]) {
				emitBlockEntity(be, tx, blocks, depth, out, topNormal);
			}
		}
	}
}

function emitBlockEntity(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	be: any,
	tx: Tx,
	blocks: Record<string, IBlock>,
	depth: number,
	out: Array<[Point2, Point2]>,
	topNormal: Vec3
): void {
	switch (be.type) {
		case "LINE":
			if (be.vertices?.length >= 2) out.push([tx(be.vertices[0]), tx(be.vertices[1])]);
			break;
		case "LWPOLYLINE":
		case "POLYLINE":
			if (be.vertices?.length >= 2) {
				for (let i = 0; i < be.vertices.length - 1; i++) {
					out.push([tx(be.vertices[i]), tx(be.vertices[i + 1])]);
				}
				if (be.shape && be.vertices.length > 2) {
					out.push([tx(be.vertices[be.vertices.length - 1]), tx(be.vertices[0])]);
				}
			}
			break;
		case "CIRCLE":
			if (be.center) pushArc(out, be.center, be.radius, 0, Math.PI * 2, tx);
			break;
		case "ARC":
			if (be.center) pushArc(out, be.center, be.radius, be.startAngle ?? 0, be.endAngle ?? 0, tx);
			break;
		case "INSERT":
			// Nested block reference: compose transforms and recurse.
			flattenInsert(be, blocks, tx, depth + 1, out, topNormal);
			break;
	}
}

function pushArc(
	segs: Array<[Point2, Point2]>,
	center: { x: number; y: number },
	radius: number,
	start: number,
	end: number,
	tx: Tx
): void {
	let sweep = end - start;
	if (sweep <= 0) sweep += Math.PI * 2;
	let prev: Point2 | null = null;
	for (let i = 0; i <= ARC_SEGMENTS; i++) {
		const a = start + (sweep * i) / ARC_SEGMENTS;
		const p = tx({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
		if (prev) segs.push([prev, p]);
		prev = p;
	}
}

// -- helpers ----------------------------------------------------------------

function xy(p: { x?: number; y?: number }): Point2 {
	return { x: p.x ?? 0, y: p.y ?? 0 };
}

function radToDeg(r: number): number {
	return (r * 180) / Math.PI;
}

function readExtrusion(tags: DxfTag[], range: TagRange): Vec3 {
	let x: number | undefined;
	let y: number | undefined;
	let z: number | undefined;
	for (let i = range.start + 1; i < range.end; i++) {
		const t = tags[i];
		if (t.code === 0) break;
		if (t.code === 210) x = parseFloat(t.value);
		else if (t.code === 220) y = parseFloat(t.value);
		else if (t.code === 230) z = parseFloat(t.value);
	}
	if (x === undefined && y === undefined && z === undefined) return WCS_NORMAL;
	return { x: x ?? 0, y: y ?? 0, z: z ?? 1 };
}

/** Read the fields we surface/edit from a LAYER table entry's raw tags. */
function readLayerTags(
	tags: DxfTag[],
	range: TagRange
): { colorRaw?: number; flags?: number; lineType?: string; lineWeight?: number } {
	const out: { colorRaw?: number; flags?: number; lineType?: string; lineWeight?: number } = {};
	for (let i = range.start + 1; i < range.end; i++) {
		const t = tags[i];
		if (t.code === 62 && out.colorRaw === undefined) out.colorRaw = parseInt(t.value, 10);
		else if (t.code === 70 && out.flags === undefined) out.flags = parseInt(t.value, 10);
		else if (t.code === 6 && out.lineType === undefined) out.lineType = t.value;
		else if (t.code === 370 && out.lineWeight === undefined) out.lineWeight = parseInt(t.value, 10);
	}
	return out;
}

function readLayer(tags: DxfTag[], range: TagRange): string {
	for (let i = range.start + 1; i < range.end; i++) {
		if (tags[i].code === 8) return tags[i].value;
	}
	return "0";
}

function readFirstPoint(tags: DxfTag[], range: TagRange): Point2 | undefined {
	let px: number | undefined;
	let py: number | undefined;
	for (let i = range.start + 1; i < range.end; i++) {
		if (tags[i].code === 10 && px === undefined) px = parseFloat(tags[i].value);
		else if (tags[i].code === 20 && py === undefined) py = parseFloat(tags[i].value);
		if (px !== undefined && py !== undefined) break;
	}
	if (px === undefined || py === undefined || Number.isNaN(px) || Number.isNaN(py)) return undefined;
	return { x: px, y: py };
}
