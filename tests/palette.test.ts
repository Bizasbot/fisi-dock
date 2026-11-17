import "./helpers/palette-default.ts";
import assert from "node:assert/strict";
import test from "node:test";
import {
	_resetPalette,
	_setActivePalette,
	getPaletteToken,
	KNOWN_TAG_PALETTES,
	onPaletteChange,
	palette,
	panelVivid,
	vivid,
	type Rgb,
} from "../lib/palette.ts";

const rgb = (hex: string): Rgb => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as unknown as Rgb;

// S1: each color keeps its hue and takes the cover title's vividness (#f43888: S 90%, L 59%),
// lighter only where that reads under 4.5:1 on #161616.
test("vivid keeps the hue and takes saturation 90%, lightness 59% or lighter up to 4.5:1 (S1)", () => {
	const examples: [string, string][] = [
		["#e0af68", "#f5a838"], // amber
		["#c3a6ff", "#9464f7"], // lilac
		["#ff9b85", "#f55a38"], // coral
		["#5fd4e0", "#38e3f5"], // teal
		["#f2a7c9", "#f5388e"], // pink
		["#c9779f", "#f53894"], // deepPink
		["#8fc98f", "#38f538"], // green
		["#7b9cff", "#4c76f6"], // blue: lighter until it reads 4.5:1
		["#ff6b6b", "#f53838"], // red
		["#b48cff", "#945ff7"], // purple
		["#ff76c3", "#f538a2"], // rose
	];
	for (const [pastel, expected] of examples) assert.deepEqual([...vivid(rgb(pastel))], [...rgb(expected)], `${pastel} -> ${expected}`);
});

// "aora lo veo en la barra lateral podemos bajar la intensidad un poco?": the side panel's
// titles and counters take 75% of the way from their own color to its vivid one.
test("panelVivid goes 75% of the way from a color to its vivid one", () => {
	const examples: [string, string][] = [
		["#e0af68", "#f0aa44"], // amber
		["#c3a6ff", "#a075f9"], // lilac
		["#ff9b85", "#f86a4b"], // coral
		["#5fd4e0", "#42dff0"], // teal
		["#f2a7c9", "#f4549d"], // pink
		["#8fc98f", "#4eea4e"], // green
		["#7b9cff", "#5880f8"], // blue
		["#ff6b6b", "#f84545"], // red
		["#ff76c3", "#f848aa"], // rose
	];
	for (const [pastel, expected] of examples) assert.deepEqual([...panelVivid(rgb(pastel))], [...rgb(expected)], `${pastel} -> ${expected}`);
});

test("KNOWN_TAG_PALETTES covers all standard Herdr tag presets with distinct accent and deep tones", () => {
	const expected = ["gentleman", "default", "coral", "emerald", "amber", "sky", "violet", "teal"];
	for (const name of expected) {
		assert.ok(name in KNOWN_TAG_PALETTES, `missing ${name}`);
		const pal = KNOWN_TAG_PALETTES[name];
		assert.equal(pal.accent.length, 3);
		assert.equal(pal.deep.length, 3);
		// Deep shade should be darker or equal in luminance
		const accentSum = pal.accent[0] + pal.accent[1] + pal.accent[2];
		const deepSum = pal.deep[0] + pal.deep[1] + pal.deep[2];
		assert.ok(deepSum <= accentSum, `${name}: deep shade should be darker than accent`);
	}
});

test("dynamic palette switching updates sexyPink, sexyDeepPink, frame, token and notifies listeners", () => {
	try {
		let notified = 0;
		const unsubscribe = onPaletteChange(() => {
			notified++;
		});

		// Switch to coral
		const coral = KNOWN_TAG_PALETTES.coral;
		_setActivePalette(coral.accent, coral.deep);
		assert.deepEqual([...palette.sexyPink], [...coral.accent]);
		assert.deepEqual([...palette.sexyDeepPink], [...coral.deep]);
		assert.deepEqual([...palette.frame], [...coral.accent]);
		assert.equal(getPaletteToken(), `${coral.accent.join("-")}:${coral.deep.join("-")}`);
		assert.equal(notified, 1);

		// Switch to emerald
		const emerald = KNOWN_TAG_PALETTES.emerald;
		_setActivePalette(emerald.accent, emerald.deep);
		assert.deepEqual([...palette.sexyPink], [...emerald.accent]);
		assert.deepEqual([...palette.sexyDeepPink], [...emerald.deep]);
		assert.deepEqual([...palette.frame], [...emerald.accent]);
		assert.equal(getPaletteToken(), `${emerald.accent.join("-")}:${emerald.deep.join("-")}`);
		assert.equal(notified, 2);

		unsubscribe();
	} finally {
		_resetPalette();
	}
});
