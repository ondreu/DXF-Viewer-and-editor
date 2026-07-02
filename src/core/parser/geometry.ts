import type { IDxf, IBlock } from "dxf-parser";
import type {
	RenderEntity,
	LayerInfo,
	Point2,
	TagRange,
	DxfTag,
} from "../model/types";
import { aciToRgb } from "../model/aci";

const DEFAULT_COLOR = 0x000000;
const ARC_SEGMENTS = 64;

interface RawEntityMeta {
	handle: string;
	dxfType: string;
	firstPoint?: Point2;
}

/**
 * Build the renderer's semantic model from dxf-parser output, plus surface any
 * entities dxf-parser dropped (unhandled types) as UNSUPPORTED placeholders,
 * discovered via the raw tag index. Editing and serialization key off `handle`.
 */
export function buildRenderModel(
	dxf: IDxf,
	tags: DxfTag[],
	ranges: Record<string, TagRange>
): { entities: RenderEntity[]; layers: LayerInfo[] } {
	const layerMap = dxf.tables?.layer?.layers ?? {};
	const layers: LayerInfo[] = Object.values(layerMap).map((l) => ({
		name: l.name,
		color: l.color ?? DEFAULT_COLOR,
		visible: l.visible !== false,
	}));
	const layerColor = (name: string): number =>
		layerMap[name]?.color ?? DEFAULT_COLOR;

	const resolveColor = (e: {
		color?: number;
		colorIndex?: number;
		layer?: string;
	}): { color: number; colorNumber?: number } => {
		// group 62 present -> explicit ACI; else BYLAYER.
		if (typeof e.colorIndex === "number" && e.colorIndex !== 256) {
			const rgb =
				typeof e.color === "number" ? e.color : aciToRgb(e.colorIndex);
			return { color: rgb, colorNumber: e.colorIndex };
		}
		return { color: layerColor(e.layer ?? "0") };
	};

	const entities: RenderEntity[] = [];
	const seenHandles = new Set<string>();

	for (const e of dxf.entities ?? []) {
		const handle = e.handle != null ? String(e.handle) : "";
		if (handle) seenHandles.add(handle);
		const built = buildEntity(e, handle, resolveColor, dxf.blocks ?? {});
		if (built) entities.push(built);
	}

	// Entities dxf-parser dropped (unsupported types) still exist in the raw tag
	// stream. Surface them as placeholders so they are visible and — crucially —
	// never silently discarded on save (design doc §2, §8.3).
	for (const [handle, range] of Object.entries(ranges)) {
		if (seenHandles.has(handle)) continue;
		const meta = readRawMeta(tags, range, handle);
		entities.push({
			id: handle,
			type: "UNSUPPORTED",
			dxfType: meta.dxfType,
			layer: readLayer(tags, range),
			color: 0x888888,
			position: meta.firstPoint,
		});
	}

	return { entities, layers };
}

function buildEntity(
	// dxf-parser's union entity type is loose; we narrow by `type`.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	e: any,
	handle: string,
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

	switch (e.type) {
		case "LINE": {
			const [a, b] = e.vertices ?? [];
			if (!a || !b) return null;
			return { ...base, type: "LINE", start: xy(a), end: xy(b) };
		}
		case "CIRCLE":
			if (!e.center) return null;
			return { ...base, type: "CIRCLE", center: xy(e.center), radius: e.radius };
		case "ARC":
			if (!e.center) return null;
			return {
				...base,
				type: "ARC",
				center: xy(e.center),
				radius: e.radius,
				// dxf-parser stores radians; renderer/model works in degrees.
				startAngle: radToDeg(e.startAngle ?? 0),
				endAngle: radToDeg(e.endAngle ?? 0),
			};
		case "LWPOLYLINE":
		case "POLYLINE": {
			const vertices = (e.vertices ?? []).map(xy);
			if (vertices.length < 2) return null;
			return {
				...base,
				type: e.type,
				vertices,
				closed: !!e.shape,
			};
		}
		case "TEXT":
			return {
				...base,
				type: "TEXT",
				position: xy(e.startPoint ?? { x: 0, y: 0 }),
				height: e.textHeight ?? 1,
				rotation: e.rotation ?? 0,
				text: String(e.text ?? ""),
			};
		case "MTEXT":
			return {
				...base,
				type: "MTEXT",
				position: xy(e.position ?? { x: 0, y: 0 }),
				height: e.height ?? 1,
				rotation: e.rotation ?? 0,
				text: String(e.text ?? ""),
			};
		case "INSERT":
			return {
				...base,
				type: "INSERT",
				position: xy(e.position ?? { x: 0, y: 0 }),
				segments: flattenBlock(e, blocks),
			};
		default:
			return {
				...base,
				type: "UNSUPPORTED",
				dxfType: String(e.type ?? "?"),
				color: 0x888888,
			};
	}
}

function xy(p: { x?: number; y?: number }): Point2 {
	return { x: p.x ?? 0, y: p.y ?? 0 };
}

function radToDeg(r: number): number {
	return (r * 180) / Math.PI;
}

/** Minimal one-level flatten of a block reference into line segments (§8.1). */
function flattenBlock(
	insert: { name?: string; position?: Point2; rotation?: number; xScale?: number; yScale?: number },
	blocks: Record<string, IBlock>
): Array<[Point2, Point2]> {
	const block = insert.name ? blocks[insert.name] : undefined;
	if (!block) return [];
	const ox = insert.position?.x ?? 0;
	const oy = insert.position?.y ?? 0;
	const sx = insert.xScale ?? 1;
	const sy = insert.yScale ?? 1;
	const rot = ((insert.rotation ?? 0) * Math.PI) / 180;
	const cos = Math.cos(rot);
	const sin = Math.sin(rot);
	const bx = block.position?.x ?? 0;
	const by = block.position?.y ?? 0;

	const tx = (p: { x: number; y: number }): Point2 => {
		const lx = (p.x - bx) * sx;
		const ly = (p.y - by) * sy;
		return { x: ox + lx * cos - ly * sin, y: oy + lx * sin + ly * cos };
	};

	const segs: Array<[Point2, Point2]> = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const be of (block.entities ?? []) as any[]) {
		if (be.type === "LINE" && be.vertices?.length >= 2) {
			segs.push([tx(be.vertices[0]), tx(be.vertices[1])]);
		} else if (
			(be.type === "LWPOLYLINE" || be.type === "POLYLINE") &&
			be.vertices?.length >= 2
		) {
			for (let i = 0; i < be.vertices.length - 1; i++) {
				segs.push([tx(be.vertices[i]), tx(be.vertices[i + 1])]);
			}
			if (be.shape && be.vertices.length > 2) {
				segs.push([tx(be.vertices[be.vertices.length - 1]), tx(be.vertices[0])]);
			}
		} else if (be.type === "CIRCLE" && be.center) {
			pushArc(segs, be.center, be.radius, 0, Math.PI * 2, tx);
		} else if (be.type === "ARC" && be.center) {
			pushArc(segs, be.center, be.radius, be.startAngle ?? 0, be.endAngle ?? 0, tx);
		}
	}
	return segs;
}

function pushArc(
	segs: Array<[Point2, Point2]>,
	center: { x: number; y: number },
	radius: number,
	start: number,
	end: number,
	tx: (p: { x: number; y: number }) => Point2
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

function readRawMeta(tags: DxfTag[], range: TagRange, handle: string): RawEntityMeta {
	let firstPoint: Point2 | undefined;
	let px: number | undefined;
	let py: number | undefined;
	for (let i = range.start + 1; i < range.end; i++) {
		if (tags[i].code === 10 && px === undefined) px = parseFloat(tags[i].value);
		else if (tags[i].code === 20 && py === undefined) py = parseFloat(tags[i].value);
		if (px !== undefined && py !== undefined) break;
	}
	if (px !== undefined && py !== undefined && !Number.isNaN(px) && !Number.isNaN(py)) {
		firstPoint = { x: px, y: py };
	}
	return { handle, dxfType: tags[range.start]?.value ?? "?", firstPoint };
}

function readLayer(tags: DxfTag[], range: TagRange): string {
	for (let i = range.start + 1; i < range.end; i++) {
		if (tags[i].code === 8) return tags[i].value;
	}
	return "0";
}
