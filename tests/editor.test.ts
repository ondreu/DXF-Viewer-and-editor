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
	AddLayerCommand,
	UpdateLayerCommand,
} from "../src/core/command/commands";
import { tokenize } from "../src/core/parser/tokenizer";
import { computeSnap, DEFAULT_SNAP } from "../src/interaction/snap";
import type { ArcEntity, CircleEntity, TextEntity, LineEntity } from "../src/core/model/types";

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
