import "./helpers/palette-default.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const theme = JSON.parse(readFileSync(new URL("../themes/Fisi-Dock-Canvas.json", import.meta.url), "utf8"));

// Literals copied from design/gentleman-terminal/05-gentle-shell-completo.html (Gentle Shell canvas artboard).
const CANVAS = { bg: "#060407", pinkSelection: "#2e0f1f", pink: "#f43888", text: "#f6eff3", muted: "#a08d97" };

test("canvas parity S4: the Fisi-Dock-Canvas theme carries the artboard palette", () => {
	assert.equal(theme.name, "Fisi-Dock-Canvas");
	for (const [key, value] of Object.entries(CANVAS)) assert.equal(theme.vars[key], value, key);
});

test("canvas parity S4: the transcript backgrounds sit on the canvas background", () => {
	for (const role of ["userMessageBg", "toolPendingBg", "toolSuccessBg"]) assert.equal(theme.colors[role], "bg", role);
});
