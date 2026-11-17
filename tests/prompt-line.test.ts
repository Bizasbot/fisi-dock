import assert from "node:assert/strict";
import test from "node:test";
import { fgCode, palette, vivid } from "../lib/palette.ts";
import { permissionModeLabel, renderPromptLine, shortAgentModel, shortModelName } from "../lib/prompt-line.ts";
import { visibleWidth } from "../lib/text.ts";

const plain = (lines: string[]) => lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

test("shortModelName drops the vendor prefix and joins the version with a dot", () => {
	assert.equal(shortModelName("claude-opus-5-5"), "opus-5.5");
	assert.equal(shortModelName("claude-sonnet-5-5"), "sonnet-5.5");
	assert.equal(shortModelName("gpt-5"), "gpt-5");
	assert.equal(shortModelName("grok-4.7"), "grok-4.7");
});

test("shortAgentModel drops a provider/ prefix, then shortens like shortModelName (S56)", () => {
	assert.equal(shortAgentModel("claude-bridge/claude-opus-5-5"), "opus-5.5");
	assert.equal(shortAgentModel("claude-haiku-5-5"), "haiku-5.5");
	assert.equal(shortAgentModel("openai/gpt-5"), "gpt-5");
	for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "gpt-5", "grok-4.7"]) assert.equal(shortAgentModel(id), shortModelName(id), id);
});

test("prompt line shows model and effort right-aligned on one line", () => {
	const lines = renderPromptLine({ modelId: "claude-opus-5-5", effort: "high" }, 60);
	assert.equal(lines.length, 1);
	assert.equal(visibleWidth(lines[0]), 60);
	assert.ok(plain(lines)[0].endsWith("opus-5.5 · high "));
});

test("prompt line omits effort for models without reasoning", () => {
	const [line] = plain(renderPromptLine({ modelId: "gpt-5" }, 40));
	assert.ok(line.endsWith("gpt-5 "));
	assert.ok(!line.includes("·"));
});

test("prompt line is empty without a model", () => {
	assert.deepEqual(renderPromptLine({}, 40), []);
});

test("prompt line puts a non-default permission mode first: `SUPER-YOLO · opus-5.5 · high`; NORMAL shows nothing (S84)", () => {
	const lines = renderPromptLine({ mode: "super-yolo", modelId: "claude-opus-5-5", effort: "high" }, 60);
	assert.equal(lines.length, 1);
	assert.equal(visibleWidth(lines[0]), 60);
	assert.ok(plain(lines)[0].endsWith("SUPER-YOLO · opus-5.5 · high "), plain(lines)[0]);
	assert.ok(lines[0].includes(`\x1b[1m${fgCode(vivid(palette.red))}SUPER-YOLO`), "the mode bold in vivid red, the prompt box's label (vivid labels S3)");
	assert.ok(plain(renderPromptLine({ mode: "yolo", modelId: "gpt-5" }, 40))[0].endsWith("YOLO · gpt-5 "), "no effort: mode and model");
	// Gentle Shell's status bar shows the mode only when it is not NORMAL (lib/shell-bar.ts): the same rule here.
	assert.deepEqual(renderPromptLine({ mode: "normal", modelId: "claude-opus-5-5", effort: "high" }, 60), renderPromptLine({ modelId: "claude-opus-5-5", effort: "high" }, 60));
	assert.deepEqual(renderPromptLine({ mode: "NORMAL", modelId: "claude-opus-5-5", effort: "high" }, 60), renderPromptLine({ modelId: "claude-opus-5-5", effort: "high" }, 60));
	assert.deepEqual(renderPromptLine({ mode: "  ", modelId: "gpt-5" }, 40), renderPromptLine({ modelId: "gpt-5" }, 40), "blank: as without a mode");
	assert.equal(permissionModeLabel("super-yolo"), "SUPER-YOLO");
	assert.equal(permissionModeLabel("auto"), "AUTO");
	assert.equal(permissionModeLabel("normal"), undefined);
	assert.equal(permissionModeLabel(undefined), undefined);
	assert.equal(permissionModeLabel(3), undefined);
	for (const width of [60, 20, 8, 3, 0]) {
		for (const line of renderPromptLine({ mode: "super-yolo", modelId: "claude-opus-5-5", effort: "high" }, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${JSON.stringify(line)}`);
	}
});

for (const width of [60, 20, 8, 3, 0]) {
	test(`prompt line never exceeds width ${width}`, () => {
		for (const line of renderPromptLine({ modelId: "claude-opus-5-5-very-long-preview-build", effort: "xhigh" }, width)) {
			assert.ok(visibleWidth(line) <= width, `${JSON.stringify(line)} > ${width}`);
		}
	});
}

// S3: too narrow for the whole line, the labels compact like on the prompt box: tight dots, then no
// effort, then the mode alone (the model alone in normal mode); only below that is the line cut.
test("S3 prompt line compacts its labels before it cuts them", () => {
	const labels = { mode: "super-yolo", modelId: "claude-opus-5-5", effort: "high" };
	const line = (width: number, model: object = labels) => plain(renderPromptLine(model, width))[0];
	assert.equal(line(29), "SUPER-YOLO · opus-5.5 · high ");
	assert.equal(line(28), "SUPER-YOLO · opus-5.5 · high", "room for the text but not the space: whole and flush, as before");
	assert.equal(line(27), "  SUPER-YOLO·opus-5.5·high ");
	assert.equal(line(25), "SUPER-YOLO·opus-5.5·high ");
	assert.equal(line(24), "    SUPER-YOLO·opus-5.5 ");
	assert.equal(line(20), "SUPER-YOLO·opus-5.5 ");
	assert.equal(line(19), `${" ".repeat(8)}SUPER-YOLO `);
	assert.equal(line(11), "SUPER-YOLO ");
	assert.equal(line(10), "SUPER-YOL…", "too narrow even for the mode: cut, as before");
	const normal = { modelId: "claude-opus-5-5", effort: "high" };
	assert.equal(line(16, normal), "opus-5.5 · high ");
	assert.equal(line(15, normal), "opus-5.5 · high");
	assert.equal(line(14, normal), "opus-5.5·high ");
	assert.equal(line(13, normal), "    opus-5.5 ");
	assert.equal(line(9, normal), "opus-5.5 ");
	const [styled] = renderPromptLine(labels, 25);
	assert.ok(styled.includes(`\x1b[1m${fgCode(vivid(palette.red))}SUPER-YOLO`), "the mode bold in vivid red");
	assert.ok(styled.includes(`${fgCode(palette.faint)}·`) && styled.includes(`${fgCode(vivid(palette.blue))}high`), "the tight dot faint, the effort vivid blue");
	for (let width = 0; width <= 40; width++) {
		for (const model of [labels, normal]) for (const row of renderPromptLine(model, width)) assert.ok(visibleWidth(row) <= width, `${width}: ${JSON.stringify(row)}`);
	}
});

// Look settings S4, S6: soft paints the mode and effort in their plain pastels; no mode is vivid, byte for byte.
test("S4 soft colors: the mode bold in pastel red, the effort pastel blue; omitting the mode equals vivid (S6)", async () => {
	const { promptLineParts, promptLineSteps } = await import("../lib/prompt-line.ts");
	const model = { mode: "super-yolo", modelId: "claude-opus-5-5", effort: "high" };
	const [soft] = renderPromptLine(model, 60, "soft");
	assert.ok(soft.includes(`\x1b[1m${fgCode(palette.red)}SUPER-YOLO`), "the mode bold in pastel red");
	assert.ok(soft.includes(`${fgCode(palette.blue)}high`), "the effort pastel blue");
	assert.ok(!soft.includes(fgCode(vivid(palette.red))) && !soft.includes(fgCode(vivid(palette.blue))), "no vivid tone");
	assert.ok(soft.includes(`${fgCode(palette.muted)}opus-5.5`), "the model stays muted");
	assert.deepEqual(plain([soft]), plain(renderPromptLine(model, 60)), "same words and layout");
	for (const width of [60, 26, 20, 12]) assert.deepEqual(renderPromptLine(model, width), renderPromptLine(model, width, "vivid"), `${width}`);
	assert.deepEqual(promptLineParts(model), promptLineParts(model, "vivid"));
	assert.deepEqual(promptLineSteps(model), promptLineSteps(model, "vivid"));
	assert.ok(promptLineParts(model, "soft")[0].styled.includes(fgCode(palette.red)));
	assert.ok(promptLineSteps(model, "soft")[0][2].styled.includes(fgCode(palette.blue)));
});

// T7 (S5): the canvas input-bar chips under the prompt:
// `claude-bc · sonnet-5.5 · medium · ODD on · RDD off · 43% · 86.7k/200k`.
const CHIPS = { modelId: "claude-sonnet-5-5", effort: "medium", profile: "claude-bc", odd: "on", rdd: "off", context: { percent: 43, tokens: "86.7k/200k" } } as const;
const CHIP_TEXT = "claude-bc · sonnet-5.5 · medium · ODD on · RDD off · 43% · 86.7k/200k";

test("T7 the line shows profile, model, effort, ODD, RDD and context in the canvas order", () => {
	const [line] = plain(renderPromptLine(CHIPS, 100));
	assert.equal(line, `${" ".repeat(100 - CHIP_TEXT.length - 1)}${CHIP_TEXT} `);
	const withMode = plain(renderPromptLine({ ...CHIPS, mode: "yolo", rdd: "on" }, 120))[0];
	assert.ok(withMode.endsWith("YOLO · claude-bc · sonnet-5.5 · medium · ODD on · RDD on · 43% · 86.7k/200k "), withMode);
});

test("T7 a chip without its data is left out; the old three parts stay as they were", () => {
	assert.ok(plain(renderPromptLine({ ...CHIPS, profile: undefined }, 100))[0].endsWith("sonnet-5.5 · medium · ODD on · RDD off · 43% · 86.7k/200k "));
	assert.ok(plain(renderPromptLine({ ...CHIPS, odd: undefined, rdd: undefined }, 100))[0].endsWith("claude-bc · sonnet-5.5 · medium · 43% · 86.7k/200k "));
	assert.ok(plain(renderPromptLine({ ...CHIPS, context: undefined }, 100))[0].endsWith("medium · ODD on · RDD off "));
	assert.ok(plain(renderPromptLine({ ...CHIPS, context: { percent: 43 } }, 100))[0].endsWith("RDD off · 43% "), "no token counts: the percent alone");
	assert.ok(plain(renderPromptLine({ modelId: "claude-opus-5-5", effort: "high", profile: "" }, 60))[0].endsWith("opus-5.5 · high "), "a blank profile is no chip");
	assert.deepEqual(renderPromptLine({ modelId: "claude-opus-5-5", effort: "high" }, 60), renderPromptLine({ modelId: "claude-opus-5-5", effort: "high", odd: undefined, rdd: undefined, context: undefined }, 60));
	assert.deepEqual(renderPromptLine({ ...CHIPS, modelId: undefined }, 100), [], "still nothing without a model");
});

test("T7 colors: profile muted, RDD and ODD green on and dim off, context muted, amber from 70%, red from 90%", () => {
	const [styled] = renderPromptLine(CHIPS, 100);
	assert.ok(styled.includes(`${fgCode(palette.muted)}claude-bc`), "the profile muted");
	assert.ok(styled.includes(`${fgCode(vivid(palette.green))}ODD on`), "ODD on green");
	assert.ok(styled.includes(`${fgCode(palette.muted)}RDD off`), "RDD off dim");
	assert.ok(!styled.includes(`${fgCode(vivid(palette.green))}RDD`), "RDD off is not green");
	assert.ok(styled.includes(`${fgCode(palette.muted)}43%`), "the context muted under 70%");
	const rdd = renderPromptLine({ ...CHIPS, rdd: "on" }, 100)[0];
	assert.ok(rdd.includes(`${fgCode(vivid(palette.green))}RDD on`), "RDD on green");
	const at = (percent: number) => renderPromptLine({ ...CHIPS, context: { percent, tokens: "1k/2k" } }, 100)[0];
	assert.ok(at(69).includes(`${fgCode(palette.muted)}69%`));
	assert.ok(at(70).includes(`${fgCode(vivid(palette.amber))}70%`), "amber at 70");
	assert.ok(at(89).includes(`${fgCode(vivid(palette.amber))}89%`));
	assert.ok(at(90).includes(`${fgCode(vivid(palette.red))}90%`), "red at 90");
	assert.ok(at(100).includes(`${fgCode(vivid(palette.red))}100%`));
	const soft = renderPromptLine({ ...CHIPS, rdd: "on", context: { percent: 95 } }, 100, "soft")[0];
	assert.ok(soft.includes(`${fgCode(palette.green)}RDD on`) && soft.includes(`${fgCode(palette.red)}95%`), "soft: the plain pastels");
});

test("T7 compaction: no context, then no RDD/ODD, then no profile (spaced dots), then tight dots, then no effort, then the mode or model alone", () => {
	const line = (width: number, model: object = CHIPS) => plain(renderPromptLine(model, width))[0];
	assert.equal(line(CHIP_TEXT.length + 1), `${CHIP_TEXT} `);
	assert.equal(line(CHIP_TEXT.length - 1), "claude-bc · sonnet-5.5 · medium · ODD on · RDD off ".padStart(CHIP_TEXT.length - 1), "context dropped first");
	assert.equal(line(40), "claude-bc · sonnet-5.5 · medium ".padStart(40), "then RDD and ODD");
	assert.equal(line(30), "sonnet-5.5 · medium ".padStart(30), "then the profile: the line of before the chips");
	assert.equal(line(20), "sonnet-5.5 · medium ", "the S3 line, spaced, as it was");
	assert.equal(line(19), "sonnet-5.5·medium ".padStart(19), "then S3: tight dots");
	assert.equal(line(16), "sonnet-5.5 ".padStart(16), "then the effort");
	assert.equal(line(11), "sonnet-5.5 ");
	assert.equal(line(22, { ...CHIPS, mode: "super-yolo" }), "SUPER-YOLO·sonnet-5.5 ", "the mode stays beside the model");
	assert.equal(line(14, { ...CHIPS, mode: "super-yolo" }), "SUPER-YOLO ".padStart(14), "the mode is the last to go");
});

for (const width of [20, 40, 60, 100, 160]) {
	test(`T7 every chip line fits width ${width}`, () => {
		const models = [CHIPS, { ...CHIPS, mode: "super-yolo", rdd: "on", context: { percent: 95, tokens: "190.5k/200k" } }, { ...CHIPS, profile: "a-very-long-profile-name (session)", modelId: "claude-opus-5-5-very-long-preview-build" }, { modelId: "gpt-5" }];
		for (const model of models) {
			for (const row of renderPromptLine(model, width)) assert.ok(visibleWidth(row) <= width, `${width}: ${JSON.stringify(row)}`);
		}
	});
}

test("T7 every width from 0 to 160 stays inside the screen", () => {
	for (let width = 0; width <= 160; width++) {
		for (const row of renderPromptLine({ ...CHIPS, mode: "auto" }, width)) assert.ok(visibleWidth(row) <= width, `${width}: ${JSON.stringify(row)}`);
	}
});

test("T7 the prompt box top rule keeps its labels: the chips are not part of what the box paints", async () => {
	const { promptLineSteps } = await import("../lib/prompt-line.ts");
	const base = { mode: "super-yolo", modelId: "claude-opus-5-5", effort: "high" };
	assert.deepEqual(promptLineSteps(base).map((step) => step.map((part) => part.plain)), [["SUPER-YOLO", "opus-5.5", "high"], ["SUPER-YOLO", "opus-5.5"], ["SUPER-YOLO"]]);
	const kinds = promptLineSteps(CHIPS).map((step) => step.map((part) => part.kind).join(","));
	assert.deepEqual(kinds, [
		"profile,model,effort,odd,rdd,context",
		"profile,model,effort,odd,rdd",
		"profile,model,effort",
		"model,effort",
		"model",
	]);
});

test("T7 room for the chips but not the trailing space: whole and flush, like the old line (S3)", () => {
	assert.equal(plain(renderPromptLine(CHIPS, CHIP_TEXT.length))[0], CHIP_TEXT);
});

test("renderChipsLine: only the chips, right-aligned, compacted and never wider than the width (T7)", async () => {
	const { renderChipsLine } = await import("../lib/prompt-line.ts");
	const model = { modelId: "claude-opus-5-5", effort: "high", mode: "yolo", profile: "claude-bc", odd: "on" as const, rdd: "off" as const, context: { percent: 43, tokens: "86.7k/200k" } };
	const strip = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
	const full = strip(renderChipsLine(model, 100)[0]);
	assert.equal(full.trimStart(), "claude-bc · ODD on · RDD off · 43% · 86.7k/200k ");
	assert.ok(!/opus|high|YOLO/.test(full), "the box rule has those");
	assert.equal(strip(renderChipsLine(model, 40)[0]).trimStart(), "claude-bc · ODD on · RDD off ");
	for (let width = 0; width <= 160; width++) for (const line of renderChipsLine(model, width)) assert.ok(strip(line).length <= width, `${width}`);
	assert.deepEqual(renderChipsLine({ modelId: "x" }, 100), [], "no chip data: no line");
});
