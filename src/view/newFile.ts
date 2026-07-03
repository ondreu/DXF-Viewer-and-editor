import { App, Notice, TFolder, TFile, normalizePath } from "obsidian";
import { promptForText } from "./TextPromptModal";
import { NEW_DXF_TEMPLATE } from "../core/model/template";

export { NEW_DXF_TEMPLATE };

/** Turn a user-supplied name into a vault-relative, unique `.dxf` path. */
function uniqueDxfPath(app: App, dir: string, rawName: string): string {
	const base = rawName.replace(/\.dxf$/i, "").trim() || "Drawing";
	const make = (suffix: string) => normalizePath(dir ? `${dir}/${base}${suffix}.dxf` : `${base}${suffix}.dxf`);
	let path = make("");
	let i = 1;
	while (app.vault.getAbstractFileByPath(path)) path = make(` ${i++}`);
	return path;
}

/**
 * Prompt for a name and create a new, empty DXF drawing in `folder` (or the
 * vault root when null), then open it in the DXF editor. Returns the new file,
 * or null if the user cancelled or creation failed.
 */
export async function createNewDxf(app: App, folder: TFolder | null): Promise<TFile | null> {
	const name = await promptForText(app, "Drawing", "New DXF drawing name");
	if (!name) return null;
	const path = uniqueDxfPath(app, folder ? folder.path : "", name);
	try {
		const file = await app.vault.create(path, NEW_DXF_TEMPLATE);
		await app.workspace.getLeaf(false).openFile(file);
		return file;
	} catch (e) {
		new Notice(`Could not create DXF drawing: ${e instanceof Error ? e.message : String(e)}`);
		return null;
	}
}
