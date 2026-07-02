import type { DxfTag, TagRange } from "../model/types";

/** Per-entity edit: replacement tags, or `null` to delete the entity. */
export type EntityEdit = DxfTag[] | null;

export interface SerializeOptions {
	tags: DxfTag[];
	newline: string;
	ranges: Record<string, TagRange>;
	edits: Map<string, EntityEdit>;
	/** tags for newly drawn entities, injected before the ENTITIES ENDSEC */
	additions: DxfTag[];
	/** index of the ENTITIES ENDSEC tag in `tags`, or -1 if absent */
	additionsAt: number;
}

/**
 * Reconstruct DXF text from the raw tag stream, substituting only entities the
 * user edited and appending any newly drawn entities (design doc §7, §8.3).
 * Untouched tags — including whole sections the model never understood — are
 * emitted 1:1, which keeps the no-edit round-trip structurally identical.
 */
export function serialize(opts: SerializeOptions): string {
	const { tags, newline, ranges, edits, additions, additionsAt } = opts;

	const byStart = new Map<number, { end: number; edit: EntityEdit }>();
	for (const [handle, edit] of edits) {
		const range = ranges[handle];
		if (!range) continue;
		byStart.set(range.start, { end: range.end, edit });
	}

	const out: DxfTag[] = [];
	let injected = false;
	let i = 0;
	while (i < tags.length) {
		if (additions.length && i === additionsAt) {
			out.push(...additions);
			injected = true;
		}
		const patch = byStart.get(i);
		if (patch) {
			if (patch.edit !== null) out.push(...patch.edit);
			i = patch.end;
		} else {
			out.push(tags[i]);
			i++;
		}
	}

	// No ENTITIES section existed but the user drew something: synthesize one
	// just before EOF so the new geometry is not lost.
	if (additions.length && !injected) {
		const section: DxfTag[] = [
			{ code: 0, value: "SECTION" },
			{ code: 2, value: "ENTITIES" },
			...additions,
			{ code: 0, value: "ENDSEC" },
		];
		const eofIdx = out.findIndex((t) => t.code === 0 && t.value === "EOF");
		if (eofIdx >= 0) out.splice(eofIdx, 0, ...section);
		else out.push(...section);
	}

	return emit(out, newline);
}

function emit(tags: DxfTag[], newline: string): string {
	const lines: string[] = [];
	for (const t of tags) {
		lines.push(String(t.code));
		lines.push(t.value);
	}
	return lines.join(newline) + newline;
}
