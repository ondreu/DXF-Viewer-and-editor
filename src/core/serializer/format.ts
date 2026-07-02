/** Format a real for DXF output, avoiding scientific notation (design doc §8.3). */
export function fmtReal(n: number): string {
	if (!isFinite(n)) return "0.0";
	if (Object.is(n, -0)) n = 0;
	let s = n.toFixed(9);
	s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ".0");
	return s;
}

/** Allocate a fresh uppercase-hex handle above `maxHandleDec`. */
export function nextHandle(maxHandleDec: number): { handle: string; next: number } {
	const next = maxHandleDec + 1;
	return { handle: next.toString(16).toUpperCase(), next };
}
