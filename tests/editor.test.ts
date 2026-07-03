import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDxf } from "../src/core/parser/parseDocument";
import { DxfDocument } from "../src/core/model/DxfDocument";
import { CommandStack } from "../src/core/command/CommandStack";
import {
	AddEntityCommand,
	SetPropsCommand,
	SetAnchorCommand,
	RotateCommand,
	ScaleCommand,
	MirrorCommand,
	CopyCommand,
	PolarCopyCommand,
	BatchCommand,
	MoveCommand,
	AddLayerCommand,
	UpdateLayerCommand,
} from "../src/core/command/commands";
import { tokenize } from "../src/core/parser/tokenizer";
import { computeSnap, DEFAULT_SNAP } from "../src/interaction/snap";
import type { ArcEntity, CircleEntity, TextEntity, LineEntity, PolylineEntity, EllipseEntity } from "../src/core/model/types";

const FIXTURE = readFileSync(resolve(__dirname, "../fixtures/simple.dxf"), "utf-8");
const tagPairs = (t: string) => tokenize(t).tags.map((x) => `${x.code}=${x.value}`).join("\n");
const load = () => DxfDocument.fromResult(parseDxf(FIXTURE));

describe("arc drawing (new entity type)", () => {
	it("round-trips a drawn ARC with its angles", () => {
		const doc = load();
		const stack = new CommandStack(doc);
		stack.execute(new AddEntityCommand({ type: "ARC", layer: "0", center: { x: 10, y: 20 }, radius: 5, startAngle: 30, endAngle: 120 }));
		const re = parseDxf(doc.serialize());
		const arc = re.entities.find((e) => e.type === "ARC") as ArcEntity;
		expect(arc.center).toEqual({ x: 10, y: 20 });
		expect(arc.radius).toBe(5);
		expect(Math.round(arc.startAngle)).toBe(30);
		expect(Math.round(arc.endAngle)).toBe(120);
	});
});

describe("precise property edits", () => {
	it("sets a circle radius and undoes it exactly", () => {
		const doc = load();
		const circle = doc.entities.find((e) => e.type === "CIRCLE") as CircleEntity;
		const stack = new CommandStack(doc);
		stack.execute(new SetPropsCommand(circle.id, { radius: 99 }));
		let re = parseDxf(doc.serialize());
		expect((re.entities.find((e) => e.type === "CIRCLE") as CircleEntity).radius).toBe(99);
		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});

	it("sets an exact anchor position on a circle", () => {
		const doc = load();
		const circle = doc.entities.find((e) => e.type === "CIRCLE") as CircleEntity;
		const stack = new CommandStack(doc);
		stack.execute(new SetAnchorCommand(circle.id, 1, 2));
		const re = parseDxf(doc.serialize());
		expect((re.entities.find((e) => e.type === "CIRCLE") as CircleEntity).center).toEqual({ x: 1, y: 2 });
	});
});

describe("rotation", () => {
	it("rotates a line 90° about origin and undoes exactly", () => {
		const doc = load();
		const line = doc.entities.find((e) => e.type === "LINE") as LineEntity;
		const stack = new CommandStack(doc);
		// original: start (0,0) end (100,50)
		stack.execute(new RotateCommand([line.id], 0, 0, 90));
		const re = parseDxf(doc.serialize());
		const l = re.entities.find((e) => e.type === "LINE") as LineEntity;
		expect(l.start.x).toBeCloseTo(0, 6);
		expect(l.start.y).toBeCloseTo(0, 6);
		expect(l.end.x).toBeCloseTo(-50, 6);
		expect(l.end.y).toBeCloseTo(100, 6);
		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});

	it("rotates a TEXT and bumps its rotation angle", () => {
		const doc = load();
		const text = doc.entities.find((e) => e.type === "TEXT") as TextEntity;
		const before = text.rotation;
		const stack = new CommandStack(doc);
		stack.execute(new RotateCommand([text.id], text.position.x, text.position.y, 45));
		expect(text.rotation).toBeCloseTo((before + 45) % 360, 6);
	});
});

describe("scale", () => {
	it("scales a circle's centre and radius about a pivot, and undoes exactly", () => {
		const doc = load();
		const circle = doc.entities.find((e) => e.type === "CIRCLE") as CircleEntity;
		const stack = new CommandStack(doc);
		// centre (50,50), radius 25; scale 2x about the origin.
		stack.execute(new ScaleCommand([circle.id], 0, 0, 2));
		expect(circle.center).toEqual({ x: 100, y: 100 });
		expect(circle.radius).toBe(50);
		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});

	it("scales a LINE's endpoints about a pivot", () => {
		const doc = load();
		const line = doc.entities.find((e) => e.type === "LINE") as LineEntity;
		const stack = new CommandStack(doc);
		// original: start (0,0) end (100,50); scale 0.5x about (0,0).
		stack.execute(new ScaleCommand([line.id], 0, 0, 0.5));
		expect(line.start).toEqual({ x: 0, y: 0 });
		expect(line.end.x).toBeCloseTo(50, 6);
		expect(line.end.y).toBeCloseTo(25, 6);
	});
});

describe("mirror", () => {
	it("mirrors a line across the Y axis and undoes (mirror twice) exactly", () => {
		const doc = load();
		const line = doc.entities.find((e) => e.type === "LINE") as LineEntity;
		const stack = new CommandStack(doc);
		// mirror line: x = 0 (points (0,0)-(0,1))
		stack.execute(new MirrorCommand([line.id], 0, 0, 0, 1));
		expect(line.start.x).toBeCloseTo(0, 6);
		expect(line.end.x).toBeCloseTo(-100, 6);
		expect(line.end.y).toBeCloseTo(50, 6);
		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});

	it("mirrors an ARC and swaps start/end angles to keep the CCW convention", () => {
		const doc = load();
		const stack = new CommandStack(doc);
		stack.execute(new AddEntityCommand({ type: "ARC", layer: "0", center: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: 90 }));
		const arc = doc.entities.find((e) => e.type === "ARC") as ArcEntity;
		// mirror across the X axis (y = 0): quarter circle in Q1 becomes Q4.
		stack.execute(new MirrorCommand([arc.id], 0, 0, 1, 0));
		expect(arc.startAngle).toBeCloseTo(270, 6);
		expect(arc.endAngle).toBeCloseTo(0, 6);
	});
});

describe("copy", () => {
	it("duplicates a line offset by (dx, dy), leaving the original untouched", () => {
		const doc = load();
		const line = doc.entities.find((e) => e.type === "LINE") as LineEntity;
		const before = { start: { ...line.start }, end: { ...line.end } };
		const stack = new CommandStack(doc);
		const cmd = new CopyCommand([line.id], 10, 20);
		stack.execute(cmd);
		expect(line.start).toEqual(before.start);
		expect(line.end).toEqual(before.end);
		const [newId] = cmd.createdHandles;
		const copy = doc.getEntity(newId) as LineEntity;
		expect(copy.start).toEqual({ x: before.start.x + 10, y: before.start.y + 20 });
		expect(copy.end).toEqual({ x: before.end.x + 10, y: before.end.y + 20 });
		stack.undo();
		expect(doc.getEntity(newId)).toBeUndefined();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});
});

describe("polar array (PolarCopyCommand)", () => {
	it("copies an entity rotated about a pivot, keeping the original untouched", () => {
		const doc = load();
		const circle = doc.entities.find((e) => e.type === "CIRCLE") as CircleEntity;
		const before = { ...circle.center };
		const stack = new CommandStack(doc);
		const cmd = new PolarCopyCommand([circle.id], 0, 0, 90);
		stack.execute(cmd);
		expect(circle.center).toEqual(before);
		const [newId] = cmd.createdHandles;
		const copy = doc.getEntity(newId) as CircleEntity;
		// original centre (50,50) rotated 90deg CCW about the origin -> (-50,50)
		expect(copy.center.x).toBeCloseTo(-50, 6);
		expect(copy.center.y).toBeCloseTo(50, 6);
		expect(copy.radius).toBe(circle.radius);
		stack.undo();
		expect(doc.getEntity(newId)).toBeUndefined();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});
});

describe("BatchCommand", () => {
	it("undoes every grouped command in one step, in reverse order", () => {
		const doc = load();
		const line = doc.entities.find((e) => e.type === "LINE") as LineEntity;
		const circle = doc.entities.find((e) => e.type === "CIRCLE") as CircleEntity;
		const beforeLine = { start: { ...line.start }, end: { ...line.end } };
		const beforeCircle = { ...circle.center };
		const stack = new CommandStack(doc);
		stack.execute(new BatchCommand([new MoveCommand(line.id, 5, 5), new MoveCommand(circle.id, -5, -5)], "Array (rectangular)"));
		expect(line.start).toEqual({ x: beforeLine.start.x + 5, y: beforeLine.start.y + 5 });
		expect(circle.center).toEqual({ x: beforeCircle.x - 5, y: beforeCircle.y - 5 });
		expect(stack.canUndo).toBe(true);
		stack.undo();
		expect(line.start).toEqual(beforeLine.start);
		expect(line.end).toEqual(beforeLine.end);
		expect(circle.center).toEqual(beforeCircle);
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});
});

describe("ELLIPSE", () => {
	const ELLIPSE_DXF = [
		"0", "SECTION", "2", "ENTITIES",
		"0", "ELLIPSE", "5", "500", "8", "0",
		"10", "10.0", "20", "10.0", "30", "0.0",
		"11", "5.0", "21", "0.0", "31", "0.0",
		"40", "0.5", "41", "0.0", "42", "6.283185307179586",
		"0", "ENDSEC", "0", "EOF",
	].join("\n");

	it("parses centre/major-axis-endpoint/ratio, and a pure translate leaves the relative axis vector unchanged", () => {
		const doc = DxfDocument.fromResult(parseDxf(ELLIPSE_DXF));
		const ellipse = doc.entities.find((e) => e.type === "ELLIPSE") as EllipseEntity;
		expect(ellipse.center).toEqual({ x: 10, y: 10 });
		expect(ellipse.majorAxisEndpoint).toEqual({ x: 15, y: 10 });
		expect(ellipse.ratio).toBeCloseTo(0.5, 6);

		const stack = new CommandStack(doc);
		stack.execute(new MoveCommand(ellipse.id, 3, -2));
		expect(ellipse.center).toEqual({ x: 13, y: 8 });
		expect(ellipse.majorAxisEndpoint).toEqual({ x: 18, y: 8 });

		// This is the fiddly bit: DXF stores the major-axis endpoint (group 11) as a
		// vector *relative* to the centre, so re-serializing after a whole-entity
		// move must NOT also shift that raw group-11 value.
		const re = parseDxf(doc.serialize());
		const moved = re.entities.find((e) => e.type === "ELLIPSE") as EllipseEntity;
		expect(moved.center).toEqual({ x: 13, y: 8 });
		expect(moved.majorAxisEndpoint.x - moved.center.x).toBeCloseTo(5, 6);
		expect(moved.majorAxisEndpoint.y - moved.center.y).toBeCloseTo(0, 6);

		stack.undo();
		const back = parseDxf(doc.serialize());
		const backE = back.entities.find((e) => e.type === "ELLIPSE") as EllipseEntity;
		expect(backE.center).toEqual({ x: 10, y: 10 });
		expect(backE.majorAxisEndpoint).toEqual({ x: 15, y: 10 });
	});

	it("rotates an ellipse about its centre, reorienting the major axis", () => {
		const doc = DxfDocument.fromResult(parseDxf(ELLIPSE_DXF));
		const ellipse = doc.entities.find((e) => e.type === "ELLIPSE") as EllipseEntity;
		const stack = new CommandStack(doc);
		stack.execute(new RotateCommand([ellipse.id], ellipse.center.x, ellipse.center.y, 90));
		// (15,10) rotated 90deg CCW about (10,10) -> (10,15)
		expect(ellipse.majorAxisEndpoint.x).toBeCloseTo(10, 6);
		expect(ellipse.majorAxisEndpoint.y).toBeCloseTo(15, 6);
		expect(ellipse.center).toEqual({ x: 10, y: 10 });
	});

	it("draws a new ellipse via AddEntityCommand and round-trips it", () => {
		const doc = DxfDocument.fromResult(parseDxf(ELLIPSE_DXF));
		const stack = new CommandStack(doc);
		stack.execute(new AddEntityCommand({ type: "ELLIPSE", layer: "0", center: { x: 0, y: 0 }, majorAxisEndpoint: { x: 4, y: 0 }, ratio: 0.25 }));
		const re = parseDxf(doc.serialize());
		const added = re.entities.filter((e) => e.type === "ELLIPSE").pop() as EllipseEntity;
		expect(added.center).toEqual({ x: 0, y: 0 });
		expect(added.majorAxisEndpoint.x).toBeCloseTo(4, 6);
		expect(added.majorAxisEndpoint.y).toBeCloseTo(0, 6);
		expect(added.ratio).toBeCloseTo(0.25, 6);
	});
});

describe("rectangle drawing (closed LWPOLYLINE)", () => {
	it("round-trips a rectangle as a closed 4-vertex polyline", () => {
		const doc = load();
		const stack = new CommandStack(doc);
		stack.execute(new AddEntityCommand({
			type: "LWPOLYLINE",
			layer: "0",
			closed: true,
			vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }],
		}));
		const re = parseDxf(doc.serialize());
		const rect = re.entities.filter((e) => e.type === "LWPOLYLINE").pop() as PolylineEntity;
		expect(rect.closed).toBe(true);
		expect(rect.vertices).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }]);
	});
});

describe("layer table editing", () => {
	it("recolours an existing layer via group 62", () => {
		const doc = load();
		const stack = new CommandStack(doc);
		stack.execute(new UpdateLayerCommand("WALLS", { colorIndex: 5 }));
		const out = doc.serialize();
		const re = parseDxf(out);
		expect(re.layers.find((l) => l.name === "WALLS")?.colorIndex).toBe(5);
		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});

	it("turning a layer off writes a negative colour", () => {
		const doc = load();
		const stack = new CommandStack(doc);
		stack.execute(new UpdateLayerCommand("WALLS", { visible: false }));
		const re = parseDxf(doc.serialize());
		expect(re.layers.find((l) => l.name === "WALLS")?.visible).toBe(false);
	});

	it("adds a new layer to the LAYER table", () => {
		const doc = load();
		const stack = new CommandStack(doc);
		stack.execute(new AddLayerCommand("DIMS", { colorIndex: 3, lineType: "DASHED" }));
		const re = parseDxf(doc.serialize());
		const added = re.layers.find((l) => l.name === "DIMS");
		expect(added).toBeDefined();
		expect(added?.colorIndex).toBe(3);
		expect(added?.lineType).toBe("DASHED");
		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});
});

describe("extension snapping", () => {
	it("snaps to the extension of a segment beyond its endpoint", () => {
		const line: LineEntity = {
			id: "L", type: "LINE", layer: "0", color: 0,
			start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
		};
		// A point just past the end of the segment and slightly off the line.
		const snap = computeSnap({ x: 14, y: 0.2 }, [line], { ...DEFAULT_SNAP }, 1);
		expect(snap?.type).toBe("extension");
		expect(snap?.point.y).toBeCloseTo(0, 6);
		expect(snap?.point.x).toBeCloseTo(14, 6);
	});
});
