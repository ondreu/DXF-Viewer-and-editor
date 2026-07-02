import type { DxfTag, TagRange } from "../model/types";

/** Per-entity edit: replacement tags, or `null` to delete the entity. */
export type EntityEdit = DxfTag[] | null;

/**
 * Reconstruct DXF text from the raw tag stream, substituting only entities the
 * user actually edited (design doc §7, §8.3). Untouched tags — including whole
 * sections the model never understood — are emitted 1:1, which is what makes
 * the no-edit round-trip structurally identical to the original.
 */
export function serialize(
	tags: DxfTag[],
	newline: string,
	ranges: Record<string, TagRange>,
	edits: Map<string, EntityEdit>
): string {
	if (edits.size === 0) return emit(tags, newline);

	// Map each edited entity's start index -> its edit, so we can splice in order.
	const byStart = new Map<number, { end: number; edit: EntityEdit }>();
	for (const [handle, edit] of edits) {
		const range = ranges[handle];
		if (!range) continue; // unaddressable entity; cannot edit safely
		byStart.set(range.start, { end: range.end, edit });
	}

	const out: DxfTag[] = [];
	let i = 0;
	while (i < tags.length) {
		const patch = byStart.get(i);
		if (patch) {
			if (patch.edit !== null) out.push(...patch.edit);
			i = patch.end; // skip original entity tags
		} else {
			out.push(tags[i]);
			i++;
		}
	}
	return emit(out, newline);
}

function emit(tags: DxfTag[], newline: string): string {
	const lines: string[] = [];
	for (const t of tags) {
		lines.push(String(t.code));
		lines.push(t.value);
	}
	// DXF files conventionally end with a trailing newline after the EOF value.
	return lines.join(newline) + newline;
}
