// The canvas working row (gentle-shell-canvas-parity S4), as the artboard
// 05-gentle-shell-completo draws it above the prompt box while the agent works:
// `✿ TRABAJANDO ▰▰▰▰▰▰ 0:42 · esc para interrumpir`: the turning petal, the wave
// label, a 6-cell bar whose colors walk one cell per step, the elapsed time and the
// muted hint. Petal and wave are the prompt box's (lib/label-wave.ts) on the same
// clock moment; the time is the rail's formatElapsed. No timer of its own: it paints
// the moment it is given, and the wave clock's frames repaint it. A narrow row
// drops the hint, then the bar, then shortens the label; the time stays.
import { WAVE_STEP_MS, WAVE_STILL_AT, waveLabel, wavePetal } from "./label-wave.ts";
import type { Accent, ColorMode } from "./look.ts";
import { fg, paint, palette, tone, type Rgb } from "./palette.ts";
import { formatElapsed } from "./panel.ts";
import { ellipsize, truncateToWidth, visibleWidth } from "./text.ts";

export const WORKING_LABEL = "TRABAJANDO";
export const WORKING_HINT = "· esc para interrumpir";
const BAR_GLYPH = "▰";
/** The artboard's rbar colors (COLORS in its script), on the Fisi Dock palette: warm to violet. */
const BAR_COLORS: readonly Rgb[] = [palette.amber, palette.green, palette.teal, palette.blue, palette.purple, palette.lilac];
/** Narrower than petal, space and a short time: no row. */
const MIN_WIDTH = 8;

export interface WorkingRowOptions {
	/** When the run started (ms); undefined while idle: no row. */
	startedAt: number | undefined;
	now: number;
	width: number;
	/** The wave clock's moment for the petal, wave and bar; the still moment when absent (potato, motion off). */
	waveAt?: number;
	colors?: ColorMode;
	accent?: Accent;
}

/** The bar's six cells at the clock moment `at`: the artboard's colors rotated one cell per step. */
function bar(at: number, colors?: ColorMode): string {
	const shift = Math.floor(at / WAVE_STEP_MS);
	return Array.from({ length: BAR_COLORS.length }, (_, index) => fg(tone(BAR_COLORS[(index + shift) % BAR_COLORS.length], colors), BAR_GLYPH)).join("");
}

/** The working row at `width` columns, or no rows while idle or too narrow. */
export function renderWorkingRow(options: WorkingRowOptions): string[] {
	const { startedAt, now, colors, accent } = options;
	const width = Math.floor(options.width);
	if (startedAt === undefined || !Number.isFinite(startedAt) || !Number.isFinite(now) || !(width >= MIN_WIDTH)) return [];
	const at = options.waveAt ?? WAVE_STILL_AT;
	const time = formatElapsed(now - startedAt);
	const muted = (text: string) => paint(fg(tone(palette.muted, colors), text), colors);
	const petal = wavePetal(at, colors, accent);
	const fixed = 2 + 1 + visibleWidth(time); // `✿ ` before the label, ` ` before the time
	const label = WORKING_LABEL.length + fixed <= width ? WORKING_LABEL : ellipsize(WORKING_LABEL, Math.max(1, width - fixed));
	const head = `${petal} ${waveLabel(label, at, accent, colors)}`;
	const barWidth = BAR_COLORS.length + 1;
	const hintWidth = visibleWidth(WORKING_HINT) + 1;
	const used = 2 + visibleWidth(label) + 1 + visibleWidth(time);
	const parts = [head];
	if (used + barWidth <= width) parts.push(paint(bar(at, colors), colors));
	parts.push(muted(time));
	if (used + (parts.length === 3 ? barWidth : 0) + hintWidth <= width) parts.push(muted(WORKING_HINT));
	return [truncateToWidth(parts.join(" "), width)];
}
