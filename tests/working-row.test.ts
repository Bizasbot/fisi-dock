import assert from "node:assert/strict";
import test from "node:test";
import { WAVE_STEP_MS } from "../lib/label-wave.ts";
import { fgCode, palette } from "../lib/palette.ts";
import { renderWorkingRow, WORKING_HINT, WORKING_LABEL } from "../lib/working-row.ts";
import { visibleWidth } from "../lib/text.ts";

// S4 (gentle-shell-canvas-parity): the canvas artboard 05-gentle-shell-completo draws the working row as
// `✿ TRABAJANDO ▰▰▰▰▰▰ 0:42 · esc para interrumpir`: petal, wave label, 6-cell bar, m:ss, hint.

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const START = 1_000_000;
const row = (seconds: number, width = 100, waveAt?: number) =>
	renderWorkingRow({ startedAt: START, now: START + seconds * 1000, width, waveAt })[0];
const PETALS = ["✿", "❀", "❁", "✾"];

test("the artboard's strings", () => {
	assert.equal(WORKING_LABEL, "TRABAJANDO");
	assert.equal(WORKING_HINT, "· esc para interrumpir");
});

test("the row is petal, label, bar, elapsed time and the hint, in the artboard's order", () => {
	for (const [seconds, time] of [[0, "0:00"], [59, "0:59"], [61, "1:01"], [3600, "1:00:00"]] as const) {
		const text = plain(row(seconds, 100, 0));
		assert.match(text, new RegExp(`^[${PETALS.join("")}] TRABAJANDO ▰{6} ${time} · esc para interrumpir$`), `${seconds}s`);
	}
});

test("the time counts from startedAt and never goes negative", () => {
	assert.match(plain(renderWorkingRow({ startedAt: START, now: START - 5000, width: 100 })[0]), / 0:00 /);
	assert.match(plain(renderWorkingRow({ startedAt: START, now: START + 42_900, width: 100 })[0]), / 0:42 /);
});

test("never wider than the width, and the hint, then the bar, then the label give way", () => {
	for (const width of [8, 12, 20, 24, 30, 40, 46, 47, 60, 100]) {
		for (const seconds of [0, 61, 3600]) {
			const [line] = renderWorkingRow({ startedAt: START, now: START + seconds * 1000, width });
			assert.ok(visibleWidth(line) <= width, `${width} cols, ${seconds}s: ${visibleWidth(line)}`);
		}
	}
	assert.ok(plain(row(42, 60)).endsWith(WORKING_HINT), "60 columns keep everything");
	assert.ok(plain(row(42, 100)).endsWith(WORKING_HINT), "100 columns keep everything");
	const thirty = plain(row(42, 30));
	assert.ok(!thirty.includes("esc para"), "30 columns drop the hint");
	assert.match(thirty, /TRABAJANDO ▰{6} 0:42$/, "but keep the bar and the time");
	const twenty = plain(row(42, 20));
	assert.ok(!twenty.includes("▰") && twenty.endsWith("0:42"), "20 columns drop the bar and keep the time");
	const twelve = plain(row(42, 12));
	assert.ok(twelve.endsWith("0:42") && twelve.includes("…"), "12 columns shorten the label");
});

test("nothing while idle, or when there is no room", () => {
	assert.deepEqual(renderWorkingRow({ startedAt: undefined, now: START, width: 100 }), []);
	assert.deepEqual(renderWorkingRow({ startedAt: Number.NaN, now: START, width: 100 }), []);
	assert.deepEqual(renderWorkingRow({ startedAt: START, now: START, width: 5 }), []);
});

test("the petal, the wave and the bar move with the clock; one step is one frame", () => {
	const a = row(5, 100, WAVE_STEP_MS * 3);
	assert.equal(a, row(5, 100, WAVE_STEP_MS * 3 + WAVE_STEP_MS - 1), "within a step nothing moves");
	assert.notEqual(a, row(5, 100, WAVE_STEP_MS * 4), "the next step moves it");
	assert.equal(plain(a).slice(2), plain(row(5, 100, WAVE_STEP_MS * 4)).slice(2), "only the colors and the petal move");
});

test("without a clock moment the row stands still", () => {
	assert.equal(row(5, 100, undefined), row(5, 100, 0));
});

test("colors come from the Fisi Dock palette", () => {
	const line = row(5, 100, 0);
	for (const name of ["amber", "green", "teal", "blue", "purple", "lilac"] as const) assert.ok(line.includes(fgCode(palette[name])), name);
	assert.ok(line.includes(fgCode(palette.muted)), "the hint and the time are muted");
});
