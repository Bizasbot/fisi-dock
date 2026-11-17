import { existsSync, readdirSync, readFileSync, statSync, watch } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Design 07 palette in 24-bit color. The panel paints with its own accents
// instead of Pi theme roles so each section keeps its hue (S9).

export type Rgb = readonly [number, number, number];

export const BACKGROUND: Rgb = [0x16, 0x16, 0x16];

export function parseHex(hex: string): Rgb | null {
	const clean = hex.replace(/^#/, "").trim();
	if (clean.length === 6) {
		const num = Number.parseInt(clean, 16);
		if (!Number.isNaN(num)) {
			return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
		}
	}
	return null;
}

export const KNOWN_TAG_PALETTES: Record<string, { accent: Rgb; deep: Rgb }> = {
	gentleman: { accent: [0xf4, 0x38, 0x88], deep: [0xbf, 0x0f, 0x50] },
	default: { accent: [0xf4, 0x38, 0x88], deep: [0xbf, 0x0f, 0x50] },
	coral: { accent: [0xff, 0x71, 0x8f], deep: [0xb4, 0x2d, 0x41] },
	emerald: { accent: [0xa6, 0xe3, 0xa1], deep: [0x23, 0x6e, 0x3c] },
	amber: { accent: [0xe0, 0xc2, 0x7a], deep: [0xa5, 0x7d, 0x1e] },
	sky: { accent: [0xa9, 0xc7, 0xee], deep: [0x23, 0x5f, 0x96] },
	violet: { accent: [0xc4, 0x9b, 0xff], deep: [0x69, 0x37, 0xa0] },
	teal: { accent: [0x5f, 0xd4, 0xe0], deep: [0x19, 0x73, 0x7d] },
};

function findDeepForAccent(accent: Rgb): Rgb {
	for (const entry of Object.values(KNOWN_TAG_PALETTES)) {
		if (entry.accent[0] === accent[0] && entry.accent[1] === accent[1] && entry.accent[2] === accent[2]) {
			return entry.deep;
		}
	}
	// Fallback dark shade: ~55% blend with black/background
	return [
		Math.round(accent[0] * 0.55),
		Math.round(accent[1] * 0.55),
		Math.round(accent[2] * 0.55),
	];
}

let activeAccent: Rgb = [0xf4, 0x38, 0x88];
let activeDeep: Rgb = [0xbf, 0x0f, 0x50];
let paletteVersion = 1;
const paletteListeners = new Set<() => void>();

export function getPaletteToken(): string {
	return `${activeAccent[0]}-${activeAccent[1]}-${activeAccent[2]}:${activeDeep[0]}-${activeDeep[1]}-${activeDeep[2]}`;
}

export function onPaletteChange(callback: () => void): () => void {
	paletteListeners.add(callback);
	return () => paletteListeners.delete(callback);
}

function resolveThemesDir(): string {
	try {
		return join(dirname(fileURLToPath(import.meta.url)), "..", "themes");
	} catch {
		return "C:/DESARROLLO - ALEX/fisi-dock/themes";
	}
}

/**
 * Synchronize the dynamic theme colors from active-palette.json or Fisi-Dock.json
 * or Herdr preferences on disk.
 */
export function syncPaletteFromDisk(): boolean {
	let nextAccent: Rgb | null = null;
	let nextDeep: Rgb | null = null;

	// FISI_DOCK_PALETTE=default pins the shipped gentleman pink and skips the disk, so tests
	// do not depend on the local palette. Unset (the runtime default), the disk decides.
	const pinned = process.env.FISI_DOCK_PALETTE?.trim().toLowerCase() === "default";
	if (pinned) {
		nextAccent = KNOWN_TAG_PALETTES.default.accent;
		nextDeep = KNOWN_TAG_PALETTES.default.deep;
	}

	const themesDir = resolveThemesDir();

	// 1. Check dedicated active-palette.json
	try {
		const activePath = join(themesDir, "active-palette.json");
		if (!pinned && existsSync(activePath)) {
			const data = JSON.parse(readFileSync(activePath, "utf8"));
			if (typeof data.accent === "string") {
				nextAccent = parseHex(data.accent);
			}
			if (typeof data.deep === "string") {
				nextDeep = parseHex(data.deep);
			}
		}
	} catch {
		// Ignore read/parse error
	}

	// 2. Check Herdr client-shell preferences
	if (!nextAccent) {
		try {
			const herdrDir = join(homedir(), "AppData/Local/herdr/client-shell");
			if (existsSync(herdrDir)) {
				const files = readdirSync(herdrDir)
					.filter((f) => f.startsWith("local-") && f.endsWith(".json"))
					.sort((a, b) => {
						try {
							return statSync(join(herdrDir, b)).mtimeMs - statSync(join(herdrDir, a)).mtimeMs;
						} catch {
							return 0;
						}
					});
				for (const f of files) {
					try {
						const content = JSON.parse(readFileSync(join(herdrDir, f), "utf8"));
						if (content.sync_terminal_palette === false) {
							nextAccent = [0xf4, 0x38, 0x88];
							nextDeep = [0xbf, 0x0f, 0x50];
							break;
						}
						const palName = typeof content.sidebar_tag_palette === "string" ? content.sidebar_tag_palette.toLowerCase() : undefined;
						if (palName && KNOWN_TAG_PALETTES[palName]) {
							nextAccent = KNOWN_TAG_PALETTES[palName].accent;
							nextDeep = KNOWN_TAG_PALETTES[palName].deep;
							break;
						}
					} catch {
						// continue
					}
				}
			}
		} catch {
			// Ignore read error
		}
	}

	// 3. Check Fisi-Dock.json vars.pink and vars.deepPink
	if (!nextAccent) {
		try {
			const themePath = join(themesDir, "Fisi-Dock.json");
			if (existsSync(themePath)) {
				const data = JSON.parse(readFileSync(themePath, "utf8"));
				const vars = data?.vars;
				if (typeof vars?.pink === "string") {
					nextAccent = parseHex(vars.pink);
				}
				if (typeof vars?.deepPink === "string") {
					const deep = parseHex(vars.deepPink);
					if (deep && nextAccent && deep[0] === nextAccent[0] && deep[1] === nextAccent[1] && deep[2] === nextAccent[2]) {
						nextDeep = findDeepForAccent(nextAccent);
					} else {
						nextDeep = deep;
					}
				}
			}
		} catch {
			// Ignore read/parse error
		}
	}

	const resolvedAccent = nextAccent ?? [0xf4, 0x38, 0x88];
	const resolvedDeep = nextDeep ?? findDeepForAccent(resolvedAccent);

	const changed =
		resolvedAccent[0] !== activeAccent[0] ||
		resolvedAccent[1] !== activeAccent[1] ||
		resolvedAccent[2] !== activeAccent[2] ||
		resolvedDeep[0] !== activeDeep[0] ||
		resolvedDeep[1] !== activeDeep[1] ||
		resolvedDeep[2] !== activeDeep[2];

	if (changed) {
		activeAccent = resolvedAccent;
		activeDeep = resolvedDeep;
		paletteVersion++;
		for (const listener of paletteListeners) {
			try {
				listener();
			} catch {
				// Ignore listener errors
			}
		}
	}

	return changed;
}

// Initial sync on module load
try {
	syncPaletteFromDisk();
} catch {
	// Ignore bootstrap error
}

let watcherStarted = false;
export function watchPalette(onChange?: () => void): () => void {
	if (onChange) onPaletteChange(onChange);

	if (watcherStarted) {
		return () => {};
	}
	watcherStarted = true;

	const themesDir = resolveThemesDir();
	const herdrDir = join(homedir(), "AppData/Local/herdr/client-shell");
	let timer: NodeJS.Timeout | undefined;
	const scheduleSync = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			syncPaletteFromDisk();
		}, 50);
	};

	const watchers: Array<{ close(): void }> = [];

	try {
		if (existsSync(themesDir)) {
			watchers.push(watch(themesDir, { persistent: false }, scheduleSync));
		}
	} catch {
		// Ignore watch error
	}

	try {
		if (existsSync(herdrDir)) {
			watchers.push(watch(herdrDir, { persistent: false }, scheduleSync));
		}
	} catch {
		// Ignore watch error
	}

	return () => {
		for (const w of watchers) {
			try {
				w.close();
			} catch {
				// Ignore
			}
		}
		watcherStarted = false;
	};
}

export function _setActivePalette(accent: Rgb, deep?: Rgb): void {
	activeAccent = accent;
	activeDeep = deep ?? findDeepForAccent(accent);
	paletteVersion++;
	for (const listener of paletteListeners) {
		try {
			listener();
		} catch {
			// Ignore
		}
	}
}

export function _resetPalette(): void {
	activeAccent = [0xf4, 0x38, 0x88];
	activeDeep = [0xbf, 0x0f, 0x50];
	paletteVersion++;
	for (const listener of paletteListeners) {
		try {
			listener();
		} catch {
			// Ignore
		}
	}
}

export const palette = {
	pink: [0xf2, 0xa7, 0xc9],
	/** The theme's deepPink (mdQuoteBorder): the deepest tone of Gentle Shell's petal. */
	deepPink: [0xc9, 0x77, 0x9f],
	teal: [0x5f, 0xd4, 0xe0],
	coral: [0xff, 0x9b, 0x85],
	amber: [0xe0, 0xaf, 0x68],
	lilac: [0xc3, 0xa6, 0xff],
	green: [0x8f, 0xc9, 0x8f],
	blue: [0x7b, 0x9c, 0xff],
	red: [0xff, 0x6b, 0x6b],
	/** High agent effort (S56). */
	purple: [0xb4, 0x8c, 0xff],
	/** Gentle Shell's Gentleman-Sexy theme accent and its deepPink: the wordmark's SHELL. */
	get sexyPink(): Rgb {
		return activeAccent;
	},
	get sexyDeepPink(): Rgb {
		return activeDeep;
	},
	/** Gentle Shell's banner rose. */
	rose: [0xff, 0x76, 0xc3],
	text: [0xe1, 0xe1, 0xe1],
	muted: [0x6c, 0x6c, 0x6c],
	faint: [0x4a, 0x4a, 0x4a],
	/** Section frames: Gentle Shell's Gentleman-Sexy pink accent or dynamic theme accent. */
	get frame(): Rgb {
		return activeAccent;
	},
	highlight: [0x26, 0x26, 0x26],
} as const satisfies Record<string, Rgb>;

export const RESET = "\x1b[0m";

/** Blend `color` over the panel background, keeping `amount` of the color. */
export function dim(color: Rgb, amount = 0.4): Rgb {
	return color.map((channel, index) => Math.round(channel * amount + BACKGROUND[index] * (1 - amount))) as unknown as Rgb;
}

/** The WCAG contrast of `color` on the panel background. */
function contrast(color: Rgb): number {
	const luminance = (rgb: Rgb) => {
		const [r, g, b] = rgb.map((channel) => channel / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	return (luminance(color) + 0.05) / (luminance(BACKGROUND) + 0.05);
}

/** `color`'s hue at HSL saturation 0.9 and `lightness`. */
function withLightness(color: Rgb, lightness: number): Rgb {
	const [r, g, b] = color.map((channel) => channel / 255);
	const max = Math.max(r, g, b);
	const spread = max - Math.min(r, g, b);
	let hue = 0;
	if (spread) hue = max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
	hue = (hue * 60 + 360) % 360;
	const chroma = (1 - Math.abs(2 * lightness - 1)) * 0.9;
	const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
	const m = lightness - chroma / 2;
	const sextant = Math.floor(hue / 60);
	const [r1, g1, b1] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sextant];
	return [r1, g1, b1].map((value) => Math.round((value + m) * 255)) as unknown as Rgb;
}

/**
 * The vividness of the cover title #f43888 on `color`'s own hue (vivid labels S1):
 * HSL saturation 90%, lightness 59%; a hue that then reads under 4.5:1 on the
 * background gets lighter in steps of 0.01 until it does, at most 0.80.
 */
export function vivid(color: Rgb): Rgb {
	for (let step = 59; step < 80; step++) {
		const out = withLightness(color, step / 100);
		if (contrast(out) >= 4.5) return out;
	}
	return withLightness(color, 0.8);
}

/** How far the side panel's titles and counters go from their own color toward its vivid one: a little calmer than the prompt labels. */
export const PANEL_VIVIDNESS = 0.75;

/** `color` PANEL_VIVIDNESS of the way to `vivid(color)`: the side panel's titles and counters. */
export function panelVivid(color: Rgb): Rgb {
	const target = vivid(color);
	return color.map((channel, index) => Math.round(channel + (target[index] - channel) * PANEL_VIVIDNESS)) as unknown as Rgb;
}

export const fgCode = ([r, g, b]: Rgb) => `\x1b[38;2;${r};${g};${b}m`;
export const bgCode = ([r, g, b]: Rgb) => `\x1b[48;2;${r};${g};${b}m`;

// Style closers reset only their own attribute, so a row background survives.
export const fg = (color: Rgb, text: string) => (text ? `${fgCode(color)}${text}\x1b[39m` : "");
export const bold = (text: string) => (text ? `\x1b[1m${text}\x1b[22m` : "");
