export interface DxfPluginSettings {
	/** show a coordinate crosshair marker for unsupported entities */
	showUnsupportedMarkers: boolean;
	/** distance (drawing units) applied by arrow-key nudge of a selected entity */
	nudgeStep: number;
	/** confirm before deleting an entity */
	confirmDelete: boolean;
	/** default fixed height (px) for note embeds */
	embedHeight: number;
}

export const DEFAULT_SETTINGS: DxfPluginSettings = {
	showUnsupportedMarkers: true,
	nudgeStep: 1,
	confirmDelete: true,
	embedHeight: 400,
};
