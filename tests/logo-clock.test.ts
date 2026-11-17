import assert from "node:assert/strict";
import test from "node:test";
import { createLogoClock, LOGO_STEP_MS } from "../lib/logo-clock.ts";

test("logo clock: runs at LOGO_STEP_MS while started and calls requestRender", () => {
	process.env.FISI_DOCK_LOGO_TEST = "1";
	let renders = 0;
	let nowMs = 1000;
	let timerCb: (() => void) | undefined;
	const clock = createLogoClock({
		now: () => nowMs,
		motion: () => "quality",
		requestRender: () => { renders += 1; },
		setInterval: (tick, ms) => {
			assert.equal(ms, LOGO_STEP_MS);
			timerCb = tick;
			return 1;
		},
		clearInterval: () => { timerCb = undefined; },
	});

	assert.equal(clock.tick(), Math.floor(nowMs / LOGO_STEP_MS));
	clock.start();
	assert.ok(timerCb);
	timerCb!();
	assert.equal(renders, 1);

	clock.stop();
	assert.equal(timerCb, undefined);
	clock.dispose();
});

test("logo clock: potato motion returns undefined tick and never starts timer", () => {
	let timerStarted = false;
	const clock = createLogoClock({
		now: () => 1000,
		motion: () => "potato",
		requestRender: () => {},
		setInterval: () => { timerStarted = true; return 1; },
	});

	assert.equal(clock.tick(), undefined);
	clock.start();
	assert.equal(timerStarted, false);
	clock.dispose();
});
