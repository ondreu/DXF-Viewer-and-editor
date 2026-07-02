import type { DxfTag, TagRange } from "../model/types";

/**
 * Tokenize ASCII DXF into (code, value) tag pairs — the raw passthrough store
 * (design doc §7). This is the source of truth for serialization: an unedited
 * document re-emits these tags 1:1, guaranteeing structural round-trip fidelity.
 *
 * Binary DXF is not supported in v1; callers should detect it upstream.
 */
export function tokenize(text: string): { tags: DxfTag[]; newline: string } {
	const newline = text.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
	// Split on any newline flavor; trim a stray \r so mixed endings still parse.
	const lines = text.split(/\r\n|\r|\n/);
	const tags: DxfTag[] = [];
	// DXF pairs are two lines: a numeric group code then its value.
	for (let i = 0; i + 1 < lines.length; i += 2) {
		const codeStr = lines[i].trim();
		if (codeStr === "") continue;
		const code = parseInt(codeStr, 10);
		if (Number.isNaN(code)) {
			// Malformed pair — skip the code line and resync on the next.
			i -= 1;
			continue;
		}
		tags.push({ code, value: lines[i + 1] });
	}
	return { tags, newline };
}

export function isBinaryDxf(bytes: Uint8Array): boolean {
	// Binary DXF files begin with this sentinel string.
	const sentinel = "AutoCAD Binary DXF";
	if (bytes.length < sentinel.length) return false;
	for (let i = 0; i < sentinel.length; i++) {
		if (bytes[i] !== sentinel.charCodeAt(i)) return false;
	}
	return true;
}

/** Locate [start,end) tag indices of the ENTITIES section body (excludes markers). */
export function findEntitiesSection(tags: DxfTag[]): TagRange | null {
	let start = -1;
	for (let i = 0; i < tags.length - 1; i++) {
		if (tags[i].code === 0 && tags[i].value === "SECTION" && tags[i + 1].code === 2 && tags[i + 1].value === "ENTITIES") {
			start = i + 2;
			break;
		}
	}
	if (start === -1) return null;
	for (let i = start; i < tags.length; i++) {
		if (tags[i].code === 0 && tags[i].value === "ENDSEC") {
			return { start, end: i };
		}
	}
	return null;
}

/**
 * Split the ENTITIES section into per-entity tag ranges, keyed by handle
 * (group code 5). Entities without a handle are still returned (in `anonymous`)
 * so they render, but cannot be safely addressed for editing.
 */
export function indexEntities(
	tags: DxfTag[],
	section: TagRange
): { ranges: Record<string, TagRange>; order: string[]; anonymous: TagRange[] } {
	const ranges: Record<string, TagRange> = {};
	const order: string[] = [];
	const anonymous: TagRange[] = [];

	let cursor = section.start;
	while (cursor < section.end) {
		if (tags[cursor].code !== 0) {
			cursor++;
			continue;
		}
		// entity runs from this `0` tag to the next `0` tag (or section end)
		let next = cursor + 1;
		while (next < section.end && tags[next].code !== 0) next++;
		const range: TagRange = { start: cursor, end: next };

		let handle = "";
		for (let i = cursor + 1; i < next; i++) {
			if (tags[i].code === 5) {
				handle = tags[i].value;
				break;
			}
		}
		if (handle) {
			ranges[handle] = range;
			order.push(handle);
		} else {
			anonymous.push(range);
		}
		cursor = next;
	}
	return { ranges, order, anonymous };
}
