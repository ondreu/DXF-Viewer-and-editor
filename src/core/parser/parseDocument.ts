import DxfParser from "dxf-parser";
import { tokenize, findEntitiesSection, indexEntities } from "./tokenizer";
import { buildRenderModel } from "./geometry";
import type { ParseResult } from "../model/types";

/** Pure DXF -> ParseResult. Runs identically in the worker and as a fallback. */
export function parseDxf(text: string): ParseResult {
	const { tags, newline } = tokenize(text);
	const section = findEntitiesSection(tags);
	const ranges = section ? indexEntities(tags, section).ranges : {};

	const dxf = new DxfParser().parseSync(text);
	if (!dxf) throw new Error("dxf-parser returned no document");

	const { entities, layers } = buildRenderModel(dxf, tags, ranges);
	const fullyAddressable = entities.every((e) => e.id !== "" && !!ranges[e.id]);

	// Largest hex handle in the file, so new entities can allocate above it.
	let maxHandle = 0;
	for (const h of Object.keys(ranges)) {
		const n = parseInt(h, 16);
		if (!Number.isNaN(n) && n > maxHandle) maxHandle = n;
	}

	return {
		tags,
		newline,
		entities,
		ranges,
		layers,
		fullyAddressable,
		entitiesEnd: section ? section.end : -1,
		maxHandle,
	};
}
