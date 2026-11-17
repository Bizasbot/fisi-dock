import "./helpers/palette-default.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { samplePanelModel, type PanelModel } from "../lib/panel-model.ts";
import { RAIL_NARROW_WIDTH, RAIL_WIDE_MIN_WIDTH, renderAdaptiveRail, renderNarrowRail, renderRail } from "../lib/panel.ts";
import { visibleWidth } from "../lib/text.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

// A model that fills every section of the panel with values far wider than a narrow rail.
const fullModel: PanelModel = {
	...samplePanelModel,
	session: { ...samplePanelModel.session, project: "an-extremely-long-project-name-that-never-ends-in-the-rail", branch: "feature/very-long-branch-name-with-many-segments" },
	headsUp: [{ kind: "unpushed", text: "12 commits not pushed to origin/feature/very-long-branch-name" }],
	todo: { done: 2, total: 9, active: "A very long active task description that goes on past the rail", next: "Another long next task that never seems to stop", more: 6 },
	agents: [{ name: "an-agent-with-a-long-name", task: "A task text that is far too long to ever fit in the rail width", state: "running" }],
	changes: [{ status: "M", path: "packages/some/really/deep/directory/structure/with/a/file-name-that-is-long.ts", added: 1234, removed: 987 }],
};

const TITLES = ["session", "heads-up", "ODD", "RDD", "agents", "todo", "changes"];
const hasSection = (lines: string[], title: string) => lines.some((line) => plain(line).replace(/^[│ ]+/, "").startsWith(`╭─ ${title}`));

test("the narrow rail is 40 columns, set in one place, below the wide rail's threshold", () => {
	assert.equal(RAIL_NARROW_WIDTH, 40);
	assert.ok(RAIL_WIDE_MIN_WIDTH > RAIL_NARROW_WIDTH);
});

for (const width of [30, 40, 55]) {
	test(`the narrow rail never draws a line wider than ${Math.min(width, RAIL_NARROW_WIDTH)} at width ${width}`, () => {
		for (const model of [samplePanelModel, fullModel]) {
			const lines = renderNarrowRail(model, width);
			assert.ok(lines.length > 0);
			for (const line of lines) assert.ok(visibleWidth(line) <= Math.min(width, RAIL_NARROW_WIDTH), `${visibleWidth(line)}: ${JSON.stringify(plain(line))}`);
		}
	});

	test(`the narrow rail keeps every section at width ${width}`, () => {
		const lines = renderNarrowRail(fullModel, width);
		for (const title of TITLES) assert.ok(hasSection(lines, title), `${title} missing at ${width}`);
	});

	test(`narrow rail rows are cut with an ellipsis inside the frame at width ${width}`, () => {
		// Drop the rail's divider column (a `│` or blank and a space); what is left is the panel.
		const panel = renderNarrowRail(fullModel, width).map((line) => plain(line).slice(2).trimEnd()).filter((line) => line !== "");
		const rows = panel.filter((line) => line.startsWith("│"));
		assert.ok(rows.length > 0 && rows.some((line) => line.includes("…")), "some long value is ellipsized");
		for (const line of rows) assert.match(line, /│$/, `a framed row keeps its right border: ${JSON.stringify(line)}`);
		for (const line of panel.filter((line) => /^[╭╰]/.test(line))) assert.match(line, /[╮╯]$/, `a frame edge keeps its corner: ${JSON.stringify(line)}`);
	});
}

test("the adaptive rail falls back to the narrow rail below the wide threshold and never hides", () => {
	for (const width of [30, 40, RAIL_WIDE_MIN_WIDTH - 1]) {
		const lines = renderAdaptiveRail(fullModel, width);
		assert.deepEqual(lines, renderNarrowRail(fullModel, width));
		assert.ok(hasSection(lines, "todo"));
	}
});

test("the adaptive rail is the wide rail, unchanged, from the wide threshold up", () => {
	for (const width of [RAIL_WIDE_MIN_WIDTH, 52, 58]) assert.deepEqual(renderAdaptiveRail(fullModel, width), renderRail(fullModel, width));
});
