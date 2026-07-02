import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDxf } from "../src/core/parser/parseDocument";
import { DxfDocument } from "../src/core/model/DxfDocument";
import { CommandStack } from "../src/core/command/CommandStack";
import { AddEntityCommand } from "../src/core/command/commands";
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
});
