import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDxf } from "../src/core/parser/parseDocument";
import { DxfDocument } from "../src/core/model/DxfDocument";
import { CommandStack } from "../src/core/command/CommandStack";
import { AddEntityCommand, MoveCommand, MoveVertexCommand, RotateCommand } from "../src/core/command/commands";
import { tokenize } from "../src/core/parser/tokenizer";
import { constructionLineSegment } from "../src/core/geom/geometry2d";
import { computeSnap, DEFAULT_SNAP } from "../src/interaction/snap";
import type { ConstructionLineEntity } from "../src/core/model/types";

const FIXTURE = readFileSync(resolve(__dirname, "../fixtures/construction.dxf"), "utf-8");
const tagPairs = (t: string) => tokenize(t).tags.map((x) => `${x.code}=${x.value}`).join("\n");

describe("construction lines — parsing", () => {
	it("parses XLINE/RAY (which dxf-parser drops) as real entities, not UNSUPPORTED placeholders", () => {
		const { entities } = parseDxf(FIXTURE);
		const types = entities.map((e) => e.type).sort();
		expect(types).toEqual(["LINE", "RAY", "XLINE"]);
		const xline = entities.find((e) => e.type === "XLINE") as ConstructionLineEntity;
		expect(xline.basePoint).toEqual({ x: 10, y: 20 });
		// through = base + unit direction (1,0)
		expect(xline.through).toEqual({ x: 11, y: 20 });
		const ray = entities.find((e) => e.type === "RAY") as ConstructionLineEntity;
		expect(ray.basePoint).toEqual({ x: 5, y: 5 });
		expect(ray.through).toEqual({ x: 5, y: 6 });
	});

	it("round-trips an unedited file to a structurally identical tag stream", () => {
		const doc = DxfDocument.fromResult(parseDxf(FIXTURE));
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});

	it("treats XLINE/RAY as editable", () => {
		const doc = DxfDocument.fromResult(parseDxf(FIXTURE));
		const xline = doc.entities.find((e) => e.type === "XLINE")!;
		expect(doc.isEditable(xline.id)).toBe(true);
	});
});

describe("construction lines — drawing", () => {
	it("adds an XLINE and re-parses it, writing a unit direction vector", () => {
		const doc = DxfDocument.fromResult(parseDxf(FIXTURE));
		const stack = new CommandStack(doc);
		stack.execute(new AddEntityCommand({ type: "XLINE", layer: "0", basePoint: { x: 0, y: 0 }, through: { x: 3, y: 4 } }));

		const re = parseDxf(doc.serialize());
		const xlines = re.entities.filter((e) => e.type === "XLINE") as ConstructionLineEntity[];
		expect(xlines.length).toBe(2);
		const added = xlines.find((e) => e.basePoint.x === 0 && e.basePoint.y === 0)!;
		// direction 3,4 normalizes to 0.6,0.8 → through = base + unit dir
		expect(added.through.x).toBeCloseTo(0.6, 6);
		expect(added.through.y).toBeCloseTo(0.8, 6);
	});

	it("adds a RAY and undo restores the original serialization", () => {
		const doc = DxfDocument.fromResult(parseDxf(FIXTURE));
		const stack = new CommandStack(doc);
		stack.execute(new AddEntityCommand({ type: "RAY", layer: "0", basePoint: { x: 1, y: 1 }, through: { x: 1, y: 9 } }));
		expect(parseDxf(doc.serialize()).entities.filter((e) => e.type === "RAY").length).toBe(2);
		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});
});

describe("construction lines — editing", () => {
	it("moves the whole XLINE (base shifts, direction vector preserved on the wire)", () => {
		const doc = DxfDocument.fromResult(parseDxf(FIXTURE));
		const xline = doc.entities.find((e) => e.type === "XLINE")!;
		const stack = new CommandStack(doc);
		stack.execute(new MoveCommand(xline.id, 7, -3));

		const re = parseDxf(doc.serialize());
		const moved = re.entities.find((e) => e.type === "XLINE") as ConstructionLineEntity;
		expect(moved.basePoint).toEqual({ x: 17, y: 17 }); // 10+7, 20-3
		// direction unchanged: through still base + (1,0)
		expect(moved.through).toEqual({ x: 18, y: 17 });

		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});

	it("grip-drags the through point to reorient a loaded XLINE about its base", () => {
		const doc = DxfDocument.fromResult(parseDxf(FIXTURE));
		const xline = doc.entities.find((e) => e.type === "XLINE")!;
		const stack = new CommandStack(doc);
		// through is at (11,20); move it to (10,21) → new direction (0,1) after base (10,20)
		stack.execute(new MoveVertexCommand(xline.id, 1, -1, 1));

		const re = parseDxf(doc.serialize());
		const edited = re.entities.find((e) => e.type === "XLINE") as ConstructionLineEntity;
		expect(edited.basePoint).toEqual({ x: 10, y: 20 }); // base unchanged
		expect(edited.through.x).toBeCloseTo(10, 6);
		expect(edited.through.y).toBeCloseTo(21, 6);

		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});

	it("undoes a rotate of a drawn RAY exactly", () => {
		const doc = DxfDocument.fromResult(parseDxf(FIXTURE));
		const stack = new CommandStack(doc);
		const before = tagPairs(doc.serialize());
		const cmd = new AddEntityCommand({ type: "RAY", layer: "0", basePoint: { x: 0, y: 0 }, through: { x: 1, y: 0 } });
		stack.execute(cmd);
		stack.execute(new RotateCommand([cmd.createdHandle!], 0, 0, 90));
		const re = parseDxf(doc.serialize());
		const ray = re.entities.filter((e) => e.type === "RAY").find((e) => (e as ConstructionLineEntity).basePoint.x === 0) as ConstructionLineEntity;
		// rotated 90° CCW about origin: direction (1,0) → (0,1)
		expect(ray.through.x).toBeCloseTo(0, 6);
		expect(ray.through.y).toBeCloseTo(1, 6);
		stack.undo();
		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(before);
	});
});

describe("construction lines — geometry helpers & snapping", () => {
	it("extends an XLINE both ways and a RAY only forward", () => {
		const [a, b] = constructionLineSegment({ x: 0, y: 0 }, { x: 1, y: 0 }, false, 100);
		expect(a).toEqual({ x: -100, y: 0 });
		expect(b).toEqual({ x: 100, y: 0 });
		const [ra, rb] = constructionLineSegment({ x: 0, y: 0 }, { x: 1, y: 0 }, true, 100);
		expect(ra).toEqual({ x: 0, y: 0 }); // ray starts at base
		expect(rb).toEqual({ x: 100, y: 0 });
	});

	it("snaps to the intersection of two construction lines", () => {
		const { entities } = parseDxf(FIXTURE);
		// XLINE horizontal through y=20, RAY vertical through x=5 → intersection (5,20)
		const snap = computeSnap({ x: 5.2, y: 20.1 }, entities, { ...DEFAULT_SNAP }, 1);
		expect(snap).not.toBeNull();
		expect(snap!.type).toBe("intersection");
		expect(snap!.point.x).toBeCloseTo(5, 6);
		expect(snap!.point.y).toBeCloseTo(20, 6);
	});
});
