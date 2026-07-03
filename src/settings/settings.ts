/**
 * How readily a tool hands control back to Select once it finishes an action:
 * "sticky" keeps the tool active (draw five lines in a row without reselecting
 * it), "auto-select" snaps back to Select after every completed action, the
 * way most AutoCAD *modify* commands behave.
 */
export type ToolStickiness = "sticky" | "auto-select";

export interface DxfPluginSettings {
	/** show a coordinate crosshair marker for unsupported entities */
	showUnsupportedMarkers: boolean;
	/** distance (drawing units) applied by arrow-key nudge of a selected entity */
	nudgeStep: number;
	/** confirm before deleting an entity */
	confirmDelete: boolean;
	/** default fixed height (px) for note embeds */
	embedHeight: number;
	/** whether tools stay active after finishing an action, or snap back to Select */
	toolStickiness: ToolStickiness;
}

export const DEFAULT_SETTINGS: DxfPluginSettings = {
	showUnsupportedMarkers: true,
	nudgeStep: 1,
	confirmDelete: true,
	embedHeight: 400,
	toolStickiness: "sticky",
};
