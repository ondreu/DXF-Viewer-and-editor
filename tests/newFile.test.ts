import { describe, it, expect } from "vitest";
import { parseDxf } from "../src/core/parser/parseDocument";
import { DxfDocument } from "../src/core/model/DxfDocument";
import { CommandStack } from "../src/core/command/CommandStack";
import { AddEntityCommand } from "../src/core/command/commands";
import { NEW_DXF_TEMPLATE } from "../src/core/model/template";
import { tokenize } from "../src/core/parser/tokenizer";

const tagPairs = (t: string) => tokenize(t).tags.map((x) => `${x.code}=${x.value}`).join("\n");

describe("new DXF template", () => {
	it("parses into an empty, structurally complete document", () => {
		const r = parseDxf(NEW_DXF_TEMPLATE);
		expect(r.entities.length).toBe(0);
		expect(r.layers.map((l) => l.name)).toEqual(["0"]);
		// Both injection anchors must be found so the editor can add entities/layers.
		expect(r.entitiesEnd).toBeGreaterThanOrEqual(0);
		expect(r.layerTableEnd).toBeGreaterThanOrEqual(0);
	});

	it("round-trips unedited to a structurally identical tag stream", () => {
		const doc = DxfDocument.fromResult(parseDxf(NEW_DXF_TEMPLATE));
		expect(tagPairs(doc.serialize())).toBe(tagPairs(NEW_DXF_TEMPLATE));
	});

	it("is immediately drawable — an added entity serializes and re-parses", () => {
		const doc = DxfDocument.fromResult(parseDxf(NEW_DXF_TEMPLATE));
		const stack = new CommandStack(doc);
		stack.execute(new AddEntityCommand({ type: "LINE", layer: "0", start: { x: 0, y: 0 }, end: { x: 5, y: 5 } }));
		const re = parseDxf(doc.serialize());
		expect(re.entities.filter((e) => e.type === "LINE").length).toBe(1);
		// undo restores the pristine template exactly
		stack.undo();
		expect(tagPairs(doc.serialize())).toBe(tagPairs(NEW_DXF_TEMPLATE));
	});
});
