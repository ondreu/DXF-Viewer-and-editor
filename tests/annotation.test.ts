import { describe, it, expect } from "vitest";
import { AnnotationStore } from "../src/core/annotation/AnnotationStore";

describe("annotation store (sidecar JSON, #4)", () => {
	it("round-trips notes and measurements through JSON", () => {
		const s = new AnnotationStore();
		s.add({ id: "a1", kind: "note", at: { x: 1, y: 2 }, text: "hole here" });
		s.add({ id: "a2", kind: "measure", points: [{ x: 0, y: 0 }, { x: 3, y: 4 }], data: { kind: "distance", length: 5, dx: 3, dy: 4, angleDeg: 53.13 } });
		const json = s.toJSON("drawing.dxf");

		const s2 = new AnnotationStore();
		s2.loadJSON(json);
		expect(s2.all.length).toBe(2);
		expect(s2.all[0]).toMatchObject({ kind: "note", text: "hole here" });
		expect(s2.isDirty).toBe(false);
	});

	it("survives a corrupt sidecar without throwing", () => {
		const s = new AnnotationStore();
		s.loadJSON("{ not valid json");
		expect(s.all.length).toBe(0);
	});

	it("tracks dirty state and clears on markSaved", () => {
		const s = new AnnotationStore();
		expect(s.isDirty).toBe(false);
		s.add({ id: "x", kind: "note", at: { x: 0, y: 0 }, text: "t" });
		expect(s.isDirty).toBe(true);
		s.markSaved();
		expect(s.isDirty).toBe(false);
		s.remove("x");
		expect(s.isDirty).toBe(true);
	});

	it("renders overlay primitives for each annotation", () => {
		const s = new AnnotationStore();
		s.add({ id: "n", kind: "note", at: { x: 0, y: 0 }, text: "hi" });
		const prims = s.toOverlay(0x123456);
		expect(prims.some((p) => p.kind === "label")).toBe(true);
		expect(prims.some((p) => p.kind === "marker")).toBe(true);
	});
});
