import type { DxfTag, RenderEntity } from "../model/types";
import { fmtReal } from "./format";

/**
 * Serialize a (drawn) render entity to raw DXF tags in R12 style — no AcDb
 * subclass markers, which keeps output broadly compatible and simple. Only the
 * entity types the draw tools can create are supported here; everything loaded
 * from a file round-trips through its original raw tags instead.
 */
export function entityToTags(e: RenderEntity, handle: string): DxfTag[] | null {
	const tags: DxfTag[] = [{ code: 0, value: e.type }];
	tags.push({ code: 5, value: handle });
	tags.push({ code: 8, value: e.layer });
	if (e.colorNumber !== undefined) tags.push({ code: 62, value: String(e.colorNumber) });

	const pt = (x: number, y: number, xc: number, yc: number, zc: number) => {
		tags.push({ code: xc, value: fmtReal(x) });
		tags.push({ code: yc, value: fmtReal(y) });
		tags.push({ code: zc, value: "0.0" });
	};

	switch (e.type) {
		case "LINE":
			pt(e.start.x, e.start.y, 10, 20, 30);
			pt(e.end.x, e.end.y, 11, 21, 31);
			return tags;
		case "CIRCLE":
			pt(e.center.x, e.center.y, 10, 20, 30);
			tags.push({ code: 40, value: fmtReal(e.radius) });
			return tags;
		case "LWPOLYLINE":
			tags.push({ code: 90, value: String(e.vertices.length) });
			tags.push({ code: 70, value: e.closed ? "1" : "0" });
			for (const v of e.vertices) {
				tags.push({ code: 10, value: fmtReal(v.x) });
				tags.push({ code: 20, value: fmtReal(v.y) });
			}
			return tags;
		case "TEXT":
			pt(e.position.x, e.position.y, 10, 20, 30);
			tags.push({ code: 40, value: fmtReal(e.height) });
			tags.push({ code: 1, value: e.text });
			return tags;
		default:
			return null;
	}
}
