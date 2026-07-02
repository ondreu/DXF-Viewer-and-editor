import type { DxfTag, TagRange } from "../model/types";

/** Per-entity edit: replacement tags, or `null` to delete the entity. */
export type EntityEdit = DxfTag[] | null;

/** A raw-tag range replaced by new tags (or removed when tags is null). */
export interface Replacement {
	start: number;
	end: number;
	tags: DxfTag[] | null;
}

/** New tags inserted verbatim just before tag index `at`. */
export interface Insertion {
	at: number;
	tags: DxfTag[];
}

export interface SerializeOptions {
	tags: DxfTag[];
	newline: string;
	/** ranges [start,end) to replace, sorted or not; later applied by start index */
	replacements: Replacement[];
	/** tag runs to inject before a given index (e.g. new entities before ENDSEC) */
	insertions: Insertion[];
	/** entity additions to synthesize an ENTITIES section for if none exists */
	entityAdditions?: DxfTag[];
}

/**
 * Reconstruct DXF text from the raw tag stream, substituting only the ranges the
 * user edited and injecting new tag runs at fixed points (design doc §7, §8.3).
 * Untouched tags — including whole sections the model never understood — are
 * emitted 1:1, keeping the no-edit round-trip structurally identical.
 */
export function serialize(opts: SerializeOptions): string {
	const { tags, newline, replacements, insertions } = opts;

	const byStart = new Map<number, Replacement>();
	for (const r of replacements) byStart.set(r.start, r);
	const insertsAt = new Map<number, DxfTag[]>();
	for (const ins of insertions) {
		if (!ins.tags.length) continue;
		const prev = insertsAt.get(ins.at) ?? [];
		insertsAt.set(ins.at, [...prev, ...ins.tags]);
	}
	const injected = new Set<number>();

	const out: DxfTag[] = [];
	let i = 0;
	while (i < tags.length) {
		const ins = insertsAt.get(i);
		if (ins) {
			out.push(...ins);
			injected.add(i);
		}
		const rep = byStart.get(i);
		if (rep) {
			if (rep.tags !== null) out.push(...rep.tags);
			i = rep.end;
		} else {
			out.push(tags[i]);
			i++;
		}
	}
	// Any insertion targeted at end-of-stream (at === tags.length).
	for (const [at, itags] of insertsAt) {
		if (at >= tags.length && !injected.has(at)) out.push(...itags);
	}

	// No ENTITIES section existed but the user drew something: synthesize one
	// just before EOF so the new geometry is not lost.
	const additions = opts.entityAdditions ?? [];
	const anyEntityInjected = insertions.some((ins) => ins.tags.length && injected.has(ins.at));
	if (additions.length && !anyEntityInjected) {
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

export type { TagRange };
