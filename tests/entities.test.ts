import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDxf } from "../src/core/parser/parseDocument";
import { DxfDocument } from "../src/core/model/DxfDocument";
import { CommandStack } from "../src/core/command/CommandStack";
import { AddEntityCommand, MoveVertexCommand } from "../src/core/command/commands";
import { tokenize } from "../src/core/parser/tokenizer";

const FIXTURE = readFileSync(resolve(__dirname, "../fixtures/simple.dxf"), "utf-8");
const tagPairs = (t: string) => tokenize(t).tags.map((x) => `${x.code}=${x.value}`).join("\n");

describe("drawing new entities (design doc §8)", () => {
	it("adds a LINE, serializes it, and re-parses it back", () => {
		const doc = DxfDocument.fromResult(parseDxf(FIXTURE));
		const before = parseDxf(FIXTURE).entities.length;
		const stack = new CommandStack(doc);
		stack.execute(new AddEntityCommand({ type: "LINE", layer: "0", start: { x: 1, y: 2 }, end: { x: 3, y: 4 } }));

		const re = parseDxf(doc.serialize());
		expect(re.entities.length).toBe(before + 1);
		const line = re.entities.filter((e) => e.type === "LINE").pop() as { start: { x: number; y: number }; end: { x: number; y: number } };
		expect(line.start).toEqual({ x: 1, y: 2 });
		expect(line.end).toEqual({ x: 3, y: 4 });
	});

	it("adds a CIRCLE with an explicit colour", () => {
		const doc = DxfDocument.fromResult(parseDxf(FIXTURE));
		const stack = new CommandStack(doc);
		stack.execute(new AddEntityCommand({ type: "CIRCLE", layer: "WALLS", colorNumber: 5, center: { x: 7, y: 8 }, radius: 3 }));
		const re = parseDxf(doc.serialize());
		const c = re.entities.filter((e) => e.type === "CIRCLE").pop() as { center: { x: number; y: number }; radius: number; colorNumber?: number; layer: string };
		expect(c.center).toEqual({ x: 7, y: 8 });
		expect(c.radius).toBe(3);
		expect(c.colorNumber).toBe(5);
		expect(c.layer).toBe("WALLS");
	});

	it("moves a single line endpoint (grip drag) without touching the other end", () => {
		const doc = DxfDocument.fromResult(parseDxf(FIXTURE));
		const line = parseDxf(FIXTURE).entities.find((e) => e.type === "LINE")!;
		const stack = new CommandStack(doc);
		stack.execute(new MoveVertexCommand(line.id, 1, 5, -2)); // move the end point only

		const re = parseDxf(doc.serialize());
		const l = re.entities.find((e) => e.type === "LINE")! as { start: { x: number; y: number }; end: { x: number; y: number } };
		expect(l.start).toEqual({ x: 0, y: 0 }); // unchanged
		expect(l.end).toEqual({ x: 105, y: 48 }); // 100+5, 50-2

		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
	});

	it("undo of a draw removes it and restores the original serialization", () => {
		const doc = DxfDocument.fromResult(parseDxf(FIXTURE));
		const stack = new CommandStack(doc);
		const cmd = new AddEntityCommand({ type: "LINE", layer: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
		stack.execute(cmd);
		expect(parseDxf(doc.serialize()).entities.length).toBe(parseDxf(FIXTURE).entities.length + 1);
		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(FIXTURE));
		stack.redo();
		expect(parseDxf(doc.serialize()).entities.filter((e) => e.type === "LINE").length).toBe(2);
	});

	it("adds a solid-fill HATCH whose raw tag stream a real DXF parser can safely skip over without desyncing the rest of the file", () => {
		const doc = DxfDocument.fromResult(parseDxf(FIXTURE));
		const stack = new CommandStack(doc);
		const before = parseDxf(FIXTURE).entities.length;
		stack.execute(
			new AddEntityCommand({
				type: "HATCH",
				layer: "0",
				colorNumber: 3,
				vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
			})
		);
		// Add a LINE *after* the HATCH so a parser that mis-consumes the HATCH's
		// body would desync and either drop this LINE or misparse it.
		stack.execute(new AddEntityCommand({ type: "LINE", layer: "0", start: { x: 20, y: 20 }, end: { x: 30, y: 30 } }));

		const serialized = doc.serialize();
		// dxf-parser has no HATCH handler; it logs "Unhandled entity" and skips
		// group-by-group to the next 0-code tag. This must not throw, and the
		// trailing LINE must still parse correctly — proving the HATCH's tag
		// stream contains no stray group-0 codes that would desync the parser.
		expect(() => parseDxf(serialized)).not.toThrow();
		const re = parseDxf(serialized);
		expect(re.entities.length).toBe(before + 2); // HATCH -> UNSUPPORTED placeholder, plus the LINE
		const trailingLine = re.entities.filter((e) => e.type === "LINE").pop() as { start: { x: number; y: number }; end: { x: number; y: number } };
		expect(trailingLine.start).toEqual({ x: 20, y: 20 });
		expect(trailingLine.end).toEqual({ x: 30, y: 30 });
		// Our own parser doesn't attempt to understand arbitrary HATCH boundary
		// data (real-world hatches are far more varied), so it round-trips as an
		// UNSUPPORTED placeholder rather than a filled region — but it must still
		// carry its handle/position so it's preserved (never silently dropped).
		const hatch = re.entities.find((e) => e.type === "UNSUPPORTED" && (e as { dxfType: string }).dxfType === "HATCH");
		expect(hatch).toBeDefined();

		// The raw tag stream itself must follow the documented group-code order.
		const tags = tokenize(serialized).tags;
		const hatchStart = tags.findIndex((t) => t.code === 0 && t.value === "HATCH");
		expect(hatchStart).toBeGreaterThanOrEqual(0);
		const codesFrom = (i: number, n: number) => tags.slice(i, i + n).map((t) => t.code);
		expect(codesFrom(hatchStart, 8)).toEqual([0, 5, 8, 62, 10, 20, 30, 2]);
		// solid fill (70=1), non-associative (71=0), one boundary path (91=1),
		// external+polyline flags (92=3), no bulge (72=0), closed (73=1), 4 verts (93=4).
		expect(codesFrom(hatchStart + 8, 7)).toEqual([70, 71, 91, 92, 72, 73, 93]);
		expect(codesFrom(hatchStart + 15, 8)).toEqual([10, 20, 10, 20, 10, 20, 10, 20]);
		expect(codesFrom(hatchStart + 23, 4)).toEqual([97, 75, 76, 98]);
	});
});
