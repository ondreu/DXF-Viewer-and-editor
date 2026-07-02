/**
 * AutoCAD Color Index (ACI) -> RGB, for *display only*.
 *
 * Important: the serializer round-trips the original ACI *number* (group 62)
 * verbatim, so the approximate RGB produced here for exotic indices can never
 * corrupt a saved file — it only affects on-screen color.
 */

const FIXED: Record<number, number> = {
	0: 0x000000, // BYBLOCK
	1: 0xff0000, // red
	2: 0xffff00, // yellow
	3: 0x00ff00, // green
	4: 0x00ffff, // cyan
	5: 0x0000ff, // blue
	6: 0xff00ff, // magenta
	7: 0xffffff, // white/black (theme-dependent; renderer may override)
	8: 0x808080, // dark grey
	9: 0xc0c0c0, // light grey
	255: 0xffffff,
};

function hsvToRgb(h: number, s: number, v: number): number {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	let r = 0,
		g = 0,
		b = 0;
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	const R = Math.round((r + m) * 255);
	const G = Math.round((g + m) * 255);
	const B = Math.round((b + m) * 255);
	return (R << 16) | (G << 8) | B;
}

const cache = new Map<number, number>();

/** Resolve an ACI index (1..255) to an approximate display RGB. */
export function aciToRgb(index: number): number {
	if (index in FIXED) return FIXED[index];
	const cached = cache.get(index);
	if (cached !== undefined) return cached;

	let rgb: number;
	if (index >= 250 && index <= 254) {
		// grayscale ramp
		const g = Math.round(((index - 250) / 4) * 0x66 + 0x33);
		rgb = (g << 16) | (g << 8) | g;
	} else {
		// 10..249: sweep hue in 24 bands of 10, with value/saturation tiers.
		const band = Math.floor((index - 10) / 10); // 0..23 -> hue
		const tier = (index - 10) % 10; // 0..9 -> brightness/saturation
		const hue = (band * 15) % 360;
		const v = 1 - (Math.floor(tier / 2) / 5) * 0.55;
		const s = tier % 2 === 0 ? 1 : 0.5;
		rgb = hsvToRgb(hue, s, v);
	}
	cache.set(index, rgb);
	return rgb;
}
