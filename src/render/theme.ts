/** Colours the renderer needs, sourced from Obsidian CSS variables by the view. */
export interface RenderTheme {
	background: number;
	/** used for entities whose colour is pure black/white (BYBLOCK / index 7) */
	foreground: number;
	accent: number;
	grid: number;
}

export const DEFAULT_THEME: RenderTheme = {
	background: 0x1e1e1e,
	foreground: 0xdddddd,
	accent: 0x7f6df2,
	grid: 0x333333,
};
