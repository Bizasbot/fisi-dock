import type { ColorMode } from "./look.ts";
import { bold, fg, labelAccent, palette, tone } from "./palette.ts";
import { ellipsize, visibleWidth } from "./text.ts";

// Design 07 shows the model and effort beside the prompt. The prompt editor is
// Gentle Shell's, so Fisi Dock adds this line below it instead of replacing it.

export interface PromptLineModel {
	/** Gentle Shell's permission mode (`normal`, `auto`, `yolo`, `super-yolo`); drawn first, only when it is not normal (S84). */
	mode?: string;
	modelId?: string;
	effort?: string;
	/** Spinner frame index from `spinnerFrameIndex()`; `undefined` when the session is idle (no spinner drawn). */
	spinner?: number;
	/** True when there are attachments: a paperclip glyph (`⊕`) is shown on the right rule end. */
	clip?: boolean;
	/** Canvas chips (T7), drawn by the line under the prompt only; the prompt box never gets them. The agent-model profile's label, muted, before the model. */
	profile?: string;
	/** The ODD chip: `ODD on` (green) or `ODD off` (dim); no chip when absent. */
	odd?: "on" | "off";
	/** The RDD chip: `RDD on` (green) or `RDD off` (dim); no chip when absent. */
	rdd?: "on" | "off";
	/** The context chip `43% · 86.7k/200k`: `percent` of the window, `tokens` the already formatted `used/limit`; no chip when absent. */
	context?: { percent: number; tokens?: string };
}

/** The context chip turns amber from this percent and red from `CONTEXT_RED` (T7). */
export const CONTEXT_AMBER = 70;
export const CONTEXT_RED = 90;

/** Gentle Shell's status bar names the mode in capitals and leaves NORMAL out (lib/shell-bar.ts); the same here. */
const DEFAULT_MODE = "NORMAL";

/** `super-yolo` -> `SUPER-YOLO`; undefined for the default mode, a blank or a non-string. */
export function permissionModeLabel(mode: unknown): string | undefined {
	if (typeof mode !== "string") return undefined;
	const label = mode.trim().toUpperCase();
	return label && label !== DEFAULT_MODE ? label : undefined;
}

/** "claude-opus-5-5" -> "opus-5.5": no vendor prefix, version joined with a dot. */
export function shortModelName(id: string): string {
	return id.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, "-$1.$2");
}

/** "claude-bridge/claude-opus-5-5" -> "opus-5.5": a subagent's model, any provider/ prefix dropped (S56). */
export function shortAgentModel(id: string): string {
	return shortModelName(id.slice(id.lastIndexOf("/") + 1));
}

export interface PromptLinePart {
	kind: "mode" | "profile" | "model" | "effort" | "odd" | "rdd" | "context";
	plain: string;
	styled: string;
}

/** `ODD on` in green, `ODD off` dim (T7); the canvas switch chips. */
function switchPart(kind: "odd" | "rdd", state: "on" | "off", colors?: ColorMode): PromptLinePart {
	const plain = `${kind.toUpperCase()} ${state}`;
	const color = state === "on" ? labelAccent(palette.green, colors) : tone(palette.muted, colors);
	return { kind, plain, styled: fg(color, plain) };
}

/** `43% · 86.7k/200k`: the percent muted, amber from 70% and red from 90%; the tokens muted (T7). Undefined without a finite percent. */
function contextPart(context: PromptLineModel["context"], colors?: ColorMode): PromptLinePart | undefined {
	if (!context || !Number.isFinite(context.percent)) return undefined;
	const percent = `${Math.max(0, Math.round(context.percent))}%`;
	const rounded = Math.round(context.percent);
	const color = rounded >= CONTEXT_RED ? labelAccent(palette.red, colors) : rounded >= CONTEXT_AMBER ? labelAccent(palette.amber, colors) : tone(palette.muted, colors);
	const tokens = context.tokens?.trim();
	if (!tokens) return { kind: "context", plain: percent, styled: fg(color, percent) };
	return { kind: "context", plain: `${percent} · ${tokens}`, styled: `${fg(color, percent)}${fg(tone(palette.faint, colors), " · ")}${fg(tone(palette.muted, colors), tokens)}` };
}

/**
 * The labels in order, each plain and styled: the mode bold in vivid red, like its dot (only
 * when it is not normal), then the profile muted, the model muted, the effort in vivid blue
 * (vivid labels S3), then the canvas chips (T7): ODD and RDD (green on, dim off) and the
 * context `43% · 86.7k/200k`; each only when its data is there. Nothing without a model. Soft `colors` paint the plain red and blue (look settings S4); light
 * paints every part for a light background (look-more S5).
 * The line under the prompt and the prompt box (S88) paint the same parts.
 */
export function promptLineParts(model: PromptLineModel, colors?: ColorMode): PromptLinePart[] {
	if (!model.modelId) return [];
	const mode = permissionModeLabel(model.mode);
	const name = shortModelName(model.modelId);
	const profile = typeof model.profile === "string" ? model.profile.trim() : "";
	const context = contextPart(model.context, colors);
	return [
		...(mode ? [{ kind: "mode" as const, plain: mode, styled: bold(fg(labelAccent(palette.red, colors), mode)) }] : []),
		...(profile ? [{ kind: "profile" as const, plain: profile, styled: fg(tone(palette.muted, colors), profile) }] : []),
		{ kind: "model" as const, plain: name, styled: fg(tone(palette.muted, colors), name) },
		...(model.effort ? [{ kind: "effort" as const, plain: model.effort, styled: fg(labelAccent(palette.blue, colors), model.effort) }] : []),
		...(model.odd ? [switchPart("odd", model.odd, colors)] : []),
		...(model.rdd ? [switchPart("rdd", model.rdd, colors)] : []),
		...(context ? [context] : []),
	];
}

/** What each compact step drops on top of the one before (T7): the context first, then ODD and RDD, then the profile, then the effort. */
const DROPS: PromptLinePart["kind"][][] = [["context"], ["odd", "rdd"], ["profile"], ["effort"]];

/**
 * The parts at each compact step, widest first (S3, T7): all of them, then without the context,
 * without ODD and RDD, without the profile, without the effort, then the first alone (the
 * mode, or the model in normal mode). The mode and the model go last: the mode is the safety
 * signal. A step that drops nothing is left out; no steps without a model.
 */
export function promptLineSteps(model: PromptLineModel, colors?: ColorMode): PromptLinePart[][] {
	const parts = promptLineParts(model, colors);
	if (parts.length === 0) return [];
	const dropped = new Set<PromptLinePart["kind"]>();
	const steps = [parts, ...DROPS.map((kinds) => {
		for (const kind of kinds) dropped.add(kind);
		return parts.filter((part) => !dropped.has(part.kind));
	}), parts.slice(0, 1)];
	return steps.filter((step, index) => index === 0 || step.length < steps[index - 1].length);
}

/**
 * One right-aligned line with "MODE · profile · model · effort · ODD on · RDD off · 43% · 86.7k/200k"
 * (the mode only when it is not normal, each chip only with its data), or no line without a model.
 * Too narrow, the labels compact (S3, T7): no context, then no ODD and RDD, then no profile (the
 * line of before the chips), then tight dots (`MODE·model·effort`), then no effort, then the mode
 * alone; narrower still the line is cut.
 */
export function renderPromptLine(model: PromptLineModel, width: number, colors?: ColorMode): string[] {
	const columns = Math.max(0, Math.floor(width));
	const steps = promptLineSteps(model, colors);
	if (steps.length === 0 || columns === 0) return [];
	const plainText = steps[0].map((part) => part.plain).join(" · ");
	// One trailing space keeps the text off the terminal edge, like the input bar.
	const room = Math.max(0, columns - 1);
	// Room for the text but not the space: it stays whole, flush and muted, as before S3.
	if (visibleWidth(plainText) > room && visibleWidth(plainText) <= columns) return [ellipsize(fg(tone(palette.muted, colors), plainText), columns)];
	const compact = steps.map((parts) => ({ parts, separator: "·" }));
	// The chips (T7) give way before the dots tighten: the steps that still hold the mode, model and effort
	// of the whole line come first with their spaced dots, so a screen that held `MODE · model · effort` still does.
	const base = steps[0].filter((part) => part.kind === "mode" || part.kind === "model" || part.kind === "effort");
	const chipless = steps.filter((parts) => base.every((part) => parts.includes(part)));
	for (const { parts, separator } of [...chipless.map((parts) => ({ parts, separator: " · " })), ...compact]) {
		const text = parts.map((part) => part.plain).join(separator);
		if (visibleWidth(text) > room) continue;
		const styled = parts.map((part) => part.styled).join(fg(tone(palette.faint, colors), separator));
		return [`${" ".repeat(room - visibleWidth(text))}${styled} `];
	}
	// Cut: the mode, model and effort alone, as before the chips: the model is what stays.
	return [ellipsize(fg(tone(palette.muted, colors), base.map((part) => part.plain).join(" · ")), columns)];
}

/**
 * The chips alone (T7): profile, ODD, RDD and context, right-aligned, for under the prompt box, whose top
 * rule already carries the mode, model and effort (S88). The same compaction as the full line: no context,
 * then no ODD and RDD, then no profile; no line when no chip has data or even the last one does not fit.
 */
export function renderChipsLine(model: PromptLineModel, width: number, colors?: ColorMode): string[] {
	const columns = Math.max(0, Math.floor(width));
	const chips = promptLineParts({ ...model, modelId: model.modelId ?? "-" }, colors).filter((part) => part.kind === "profile" || part.kind === "odd" || part.kind === "rdd" || part.kind === "context");
	const room = Math.max(0, columns - 1);
	const dropped = new Set<PromptLinePart["kind"]>();
	const steps = [chips, ...DROPS.slice(0, 3).map((kinds) => {
		for (const kind of kinds) dropped.add(kind);
		return chips.filter((part) => !dropped.has(part.kind));
	})];
	for (const parts of steps) {
		if (parts.length === 0) continue;
		const text = parts.map((part) => part.plain).join(" · ");
		if (visibleWidth(text) > room) continue;
		return [`${" ".repeat(room - visibleWidth(text))}${parts.map((part) => part.styled).join(fg(tone(palette.faint, colors), " · "))} `];
	}
	return [];
}
