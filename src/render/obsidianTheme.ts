import { DEFAULT_THEME, type RenderTheme } from "./theme";

/** Resolve a CSS colour string (any form) to 0xRRGGBB using the DOM. */
function cssColorToHex(value: string, fallback: number): number {
	if (!value) return fallback;
	const probe = activeDocument.createElement("span");
	probe.setCssStyles({ color: value.trim(), display: "none" });
	activeDocument.body.appendChild(probe);
	const computed = getComputedStyle(probe).color;
	probe.remove();
	const m = computed.match(/rgba?\(([^)]+)\)/);
	if (!m) return fallback;
	const [r, g, b] = m[1].split(",").map((n) => parseInt(n.trim(), 10));
	if ([r, g, b].some((n) => Number.isNaN(n))) return fallback;
	return (r << 16) | (g << 8) | b;
}

/**
 * Build the renderer theme from the active Obsidian CSS variables so the DXF
 * canvas matches whichever Obsidian theme the user runs (light or dark).
 */
export function themeFromObsidian(host: HTMLElement): RenderTheme {
	const style = getComputedStyle(host);
	const v = (name: string) => style.getPropertyValue(name).trim();
	return {
		background: cssColorToHex(v("--background-primary"), DEFAULT_THEME.background),
		foreground: cssColorToHex(v("--text-normal"), DEFAULT_THEME.foreground),
		accent: cssColorToHex(v("--interactive-accent"), DEFAULT_THEME.accent),
		grid: cssColorToHex(v("--background-modifier-border"), DEFAULT_THEME.grid),
	};
}
