// Independently generated motion patterns. Pi supplies its own native spinner;
// no native or third-party frame sequences are copied into this module.
const scan = [0, 1, 2, 3, 4, 3, 2, 1].map(position =>
	Array.from({ length: 5 }, (_, column) => column === position ? "●" : "·").join(""));

const stack = Array.from({ length: 8 }, (_, step) => {
	const filled = step <= 4 ? step : 8 - step;
	return `[${"=".repeat(filled)}${" ".repeat(4 - filled)}]`;
});

export const SPINNERS: Record<string, readonly string[]> = { scan, stack };
