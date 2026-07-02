import { describe, it, expect } from "vitest";
import { parseDxf } from "../src/core/parser/parseDocument";
import type { CircleEntity, InsertEntity, Point2 } from "../src/core/model/types";

function dxf(entities: string, blocks = ""): string {
	return [
		"0", "SECTION", "2", "ENTITIES", entities, "0", "ENDSEC",
		"0", "EOF",
	].join("\n").replace("__BLOCKS__", blocks);
}

function withBlocks(blocks: string, entities: string): string {
	return [
		"0", "SECTION", "2", "BLOCKS", blocks, "0", "ENDSEC",
		"0", "SECTION", "2", "ENTITIES", entities, "0", "ENDSEC",
		"0", "EOF",
	].join("\n");
}

describe("bug #5: OCS / extrusion", () => {
	it("mirrors X for a circle with extrusion (0,0,-1)", () => {
		const text = dxf(
			["0", "CIRCLE", "5", "200", "8", "0", "10", "10.0", "20", "5.0", "30", "0.0",
				"40", "2.0", "210", "0.0", "220", "0.0", "230", "-1.0"].join("\n")
		);
		const { entities } = parseDxf(text);
		const circle = entities.find((e) => e.type === "CIRCLE") as CircleEntity;
		expect(circle.center.x).toBeCloseTo(-10, 6);
		expect(circle.center.y).toBeCloseTo(5, 6);
	});

	it("leaves a default-normal circle untouched", () => {
		const text = dxf(
			["0", "CIRCLE", "5", "201", "8", "0", "10", "10.0", "20", "5.0", "40", "2.0"].join("\n")
		);
		const { entities } = parseDxf(text);
		const circle = entities.find((e) => e.type === "CIRCLE") as CircleEntity;
		expect(circle.center).toEqual({ x: 10, y: 5 });
	});
});

describe("bug #5: nested INSERT flattening", () => {
	it("places a hole in a block-in-block at the composed world position", () => {
		const blocks = [
			"0", "BLOCK", "5", "300", "8", "0", "2", "INNER", "10", "0.0", "20", "0.0", "30", "0.0",
			"0", "CIRCLE", "5", "301", "8", "0", "10", "1.0", "20", "0.0", "40", "0.5",
			"0", "ENDBLK", "5", "302", "8", "0",
			"0", "BLOCK", "5", "310", "8", "0", "2", "OUTER", "10", "0.0", "20", "0.0", "30", "0.0",
			"0", "INSERT", "5", "311", "8", "0", "2", "INNER", "10", "5.0", "20", "0.0",
			"0", "ENDBLK", "5", "312", "8", "0",
		].join("\n");
		const entities = [
			"0", "INSERT", "5", "400", "8", "0", "2", "OUTER", "10", "10.0", "20", "0.0",
		].join("\n");

		const { entities: parsed } = parseDxf(withBlocks(blocks, entities));
		const insert = parsed.find((e) => e.type === "INSERT") as InsertEntity;
		expect(insert.segments.length).toBeGreaterThan(0);

		const pts: Point2[] = insert.segments.flat();
		const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
		const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
		// hole world center = 10 (outer) + 5 (inner insert) + 1 (circle local) = 16
		expect(cx).toBeCloseTo(16, 2);
		expect(cy).toBeCloseTo(0, 2);
	});
});
