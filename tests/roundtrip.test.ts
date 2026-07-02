import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDxf } from "../src/core/parser/parseDocument";
import { DxfDocument } from "../src/core/model/DxfDocument";
import { tokenize } from "../src/core/parser/tokenizer";
import { CommandStack } from "../src/core/command/CommandStack";
import { MoveCommand, DeleteCommand, ChangeLayerCommand, ChangeColorCommand } from "../src/core/command/commands";
import type { ParseResult } from "../src/core/model/types";

const FIXTURE = readFileSync(resolve(__dirname, "../fixtures/simple.dxf"), "utf-8");

function load(text = FIXTURE): { result: ParseResult; doc: DxfDocument } {
	const result = parseDxf(text);
	const doc = new DxfDocument(
		result.tags,
		result.newline,
		result.ranges,
		result.entities,
		result.layers,
		result.fullyAddressable
	);
	return { result, doc };
}

function tagPairs(text: string): string {
	return tokenize(text).tags.map((t) => `${t.code}=${t.value}`).join("\n");
}

describe("parse", () => {
	it("reads all supported entities plus an unsupported placeholder", () => {
		const { result } = load();
		const types = result.entities.map((e) => e.type).sort();
		expect(types).toEqual(["CIRCLE", "LINE", "LWPOLYLINE", "TEXT", "UNSUPPORTED"]);
	});

	it("surfaces the MLINE that dxf-parser drops as UNSUPPORTED, not silently gone", () => {
		const { result } = load();
		const un = result.entities.find((e) => e.type === "UNSUPPORTED");
		expect(un).toBeDefined();
		expect(un && (un as { dxfType: string }).dxfType).toBe("MLINE");
	});

	it("resolves ByLayer vs explicit colours", () => {
		const { result } = load();
		const circle = result.entities.find((e) => e.type === "CIRCLE")!;
		// circle is on WALLS (red, index 1) via ByLayer
		expect(circle.color).toBe(0xff0000);
		const poly = result.entities.find((e) => e.type === "LWPOLYLINE")!;
		expect(poly.colorNumber).toBe(3); // explicit green
	});
});

describe("round-trip safety net (design doc §8.3)", () => {
	it("re-serializes an unedited document to a structurally identical tag stream", () => {
		const { doc } = load();
		const out = doc.serialize();
		expect(tagPairs(out)).toBe(tagPairs(FIXTURE));
	});
});

describe("editing", () => {
	it("moves only the edited entity, preserving all other tags including the unsupported one", () => {
		const { result, doc } = load();
		const line = result.entities.find((e) => e.type === "LINE")!;
		const stack = new CommandStack(doc);
		stack.execute(new MoveCommand(line.id, 5, -3));

		const out = doc.serialize();
		const reparsed = parseDxf(out);
		const movedLine = reparsed.entities.find((e) => e.type === "LINE")! as {
			start: { x: number; y: number };
			end: { x: number; y: number };
		};
		expect(movedLine.start).toEqual({ x: 5, y: -3 });
		expect(movedLine.end).toEqual({ x: 105, y: 47 });

		// unsupported entity survives untouched
		const un = reparsed.entities.find((e) => e.type === "UNSUPPORTED");
		expect(un).toBeDefined();
		// circle untouched
		const circle = reparsed.entities.find((e) => e.type === "CIRCLE")! as {
			center: { x: number; y: number };
		};
		expect(circle.center).toEqual({ x: 50, y: 50 });
	});

	it("deletes an entity and drops exactly its tags", () => {
		const { result, doc } = load();
		const text = result.entities.find((e) => e.type === "TEXT")!;
		const stack = new CommandStack(doc);
		stack.execute(new DeleteCommand(text.id));

		const reparsed = parseDxf(doc.serialize());
		expect(reparsed.entities.find((e) => e.type === "TEXT")).toBeUndefined();
		expect(reparsed.entities.length).toBe(result.entities.length - 1);
	});

	it("changes layer and colour via patched group codes", () => {
		const { result, doc } = load();
		const line = result.entities.find((e) => e.type === "LINE")!;
		const stack = new CommandStack(doc);
		stack.execute(new ChangeLayerCommand(line.id, "WALLS"));
		stack.execute(new ChangeColorCommand(line.id, 5));

		const reparsed = parseDxf(doc.serialize());
		const l = reparsed.entities.find((e) => e.type === "LINE")!;
		expect(l.layer).toBe("WALLS");
		expect(l.colorNumber).toBe(5);
	});

	it("undo/redo restores the original serialization exactly", () => {
		const { result, doc } = load();
		const line = result.entities.find((e) => e.type === "LINE")!;
		const stack = new CommandStack(doc);
		const before = doc.serialize();
		stack.execute(new MoveCommand(line.id, 10, 10));
		expect(doc.serialize()).not.toBe(before);
		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(before));
		stack.redo();
		expect(doc.serialize()).not.toBe(before);
	});

	it("setting a ByLayer entity to a colour then back to ByLayer round-trips", () => {
		const { result, doc } = load();
		const line = result.entities.find((e) => e.type === "LINE")!; // ByLayer originally
		const stack = new CommandStack(doc);
		const before = tagPairs(doc.serialize());
		stack.execute(new ChangeColorCommand(line.id, 4));
		expect(parseDxf(doc.serialize()).entities.find((e) => e.type === "LINE")!.colorNumber).toBe(4);
		stack.execute(new ChangeColorCommand(line.id, null)); // back to ByLayer
		expect(tagPairs(doc.serialize())).toBe(before);
	});
});
