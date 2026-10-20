/** Cuts `text` to `maxChars` and says so, so the agent knows it is partial. */
export function clipText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const rest = text.length - maxChars;
	return `${text.slice(0, maxChars)}\n...[truncated: ${rest} more chars]`;
}

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "g");

export function stripAnsi(text: string): string {
	return text.replace(ANSI, "");
}

export function formatYen(value: number): string {
	return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
