import { parseDxf } from "../core/parser/parseDocument";
import type { ParseRequest, ParseResponse } from "./protocol";

/**
 * Parses DXF off the main thread so opening a large drawing never freezes the
 * Obsidian UI (design doc §6). Bundled to a standalone string by
 * esbuild.config.mjs and launched from a Blob URL — see worker/host.ts.
 */
self.onmessage = (ev: MessageEvent<ParseRequest>) => {
	const { id, text } = ev.data;
	let response: ParseResponse;
	try {
		response = { id, ok: true, result: parseDxf(text) };
	} catch (err) {
		response = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
	}
	(self as unknown as Worker).postMessage(response);
};
