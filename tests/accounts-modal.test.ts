import assert from "node:assert/strict";
import test from "node:test";
import { computeModalDimensions, frameModalBackdrop, renderQuotaMetric, renderAccountsModal } from "../lib/accounts-modal.ts";
import type { PamcAccountQuota } from "../lib/pamc.ts";

function plain(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

test("computeModalDimensions centers within available terminal size", () => {
	const dims = computeModalDimensions(120, 30);
	assert.ok(dims.width >= 46 && dims.width <= 84);
	assert.ok(dims.height >= 10 && dims.height <= 28);
	assert.ok(dims.left > 0);
	assert.ok(dims.top > 0);
});

test("renderQuotaMetric renders meter bar, percent and optional tokens", () => {
	const metricWithTokens = plain(renderQuotaMetric("5h", 25, 5000, 10, undefined, undefined, true));
	assert.ok(metricWithTokens.includes("5h"));
	assert.ok(metricWithTokens.includes("25%"));
	assert.ok(metricWithTokens.includes("5k"));
	assert.ok(metricWithTokens.includes("▰"));
	assert.ok(metricWithTokens.includes("▱"));

	const metricNoTokens = plain(renderQuotaMetric("5h", 25, 5000, 10, undefined, undefined, false));
	assert.ok(metricNoTokens.includes("5h"));
	assert.ok(metricNoTokens.includes("25%"));
	assert.ok(!metricNoTokens.includes("5k"));
});

test("renderAccountsModal formats accounts list and borders cleanly", () => {
	const accounts: PamcAccountQuota[] = [
		{
			name: "antigravity-bizasbot@gmail.com.json",
			accountName: "bizasbot",
			provider: "antigravity",
			disabled: false,
			window5h: { usedPercent: 12, remainingPercent: 88, tokens: 1200 },
			windowWeekly: { usedPercent: 45, remainingPercent: 55, tokens: 45000 },
		},
		{
			name: "claude-test@gmail.com.json",
			accountName: "test",
			provider: "claude",
			disabled: true,
			window5h: { usedPercent: 0, remainingPercent: 100 },
			windowWeekly: { usedPercent: 80, remainingPercent: 20 },
		},
	];

	const lines = renderAccountsModal(accounts, 0, 0, 50, 15).map(plain);
	assert.ok(lines.length === 15, "renders exact maxRows requested");
	assert.ok(lines[0].includes("SHELL PAMC"), "contains header title");
	assert.ok(lines.some((l) => l.includes("bizasbot")), "displays first account");
	assert.ok(lines.some((l) => l.includes("5h")), "displays 5h metric");
	assert.ok(lines.some((l) => l.includes("Sem")), "displays weekly metric");
	assert.ok(lines[lines.length - 1].includes("Esc"), "contains close hint");
});

test("renderAccountsModal orders accounts by 5h active usage and real token consumption", () => {
	const accounts: PamcAccountQuota[] = [
		{
			name: "antigravity-exhausted-weekly@gmail.com.json",
			accountName: "exhausted-weekly",
			provider: "antigravity",
			disabled: false,
			window5h: { usedPercent: 0, remainingPercent: 100 },
			windowWeekly: { usedPercent: 99, remainingPercent: 1, tokens: 10000 },
		},
		{
			name: "antigravity-active-5h@gmail.com.json",
			accountName: "active-5h",
			provider: "antigravity",
			disabled: false,
			window5h: { usedPercent: 15, remainingPercent: 85, tokens: 5000 },
			windowWeekly: { usedPercent: 20, remainingPercent: 80, tokens: 12000 },
		},
		{
			name: "antigravity-high-tokens@gmail.com.json",
			accountName: "high-tokens",
			provider: "antigravity",
			disabled: false,
			window5h: { usedPercent: 0, remainingPercent: 100 },
			windowWeekly: { usedPercent: 50, remainingPercent: 50, tokens: 500000 },
		},
	];

	const lines = renderAccountsModal(accounts, 0, 0, 70, 20).map(plain);
	const acc1Idx = lines.findIndex((l) => l.includes("active-5h"));
	const acc2Idx = lines.findIndex((l) => l.includes("high-tokens"));
	const acc3Idx = lines.findIndex((l) => l.includes("exhausted-weekly"));

	assert.ok(acc1Idx !== -1 && acc2Idx !== -1 && acc3Idx !== -1);
	assert.ok(acc1Idx < acc2Idx, "5h active account comes first");
	assert.ok(acc2Idx < acc3Idx, "account with higher real tokens comes before lower token volume");
});

test("frameModalBackdrop positions modal and fills clean background", () => {
	const box = ["╭──╮", "│hi│", "╰──╯"];
	const screen = frameModalBackdrop(box, 4, 10, 5, 1, 3);
	assert.equal(screen.length, 5);
	assert.equal(screen[0], "          ");
	assert.equal(screen[1], "   ╭──╮   ");
	assert.equal(screen[2], "   │hi│   ");
	assert.equal(screen[3], "   ╰──╯   ");
	assert.equal(screen[4], "          ");
});

// --- Model-scoped pools and connection health ---

test("renderAccountsModal keeps the model pool on its own row", () => {
	const accounts: PamcAccountQuota[] = [
		{
			name: "antigravity-zynxedit10@gmail.com.json",
			accountName: "zynxedit10",
			provider: "antigravity",
			disabled: false,
			window5h: { usedPercent: 0, remainingPercent: 100, resetAtMs: Date.now() + 3600_000 },
			windowWeekly: { usedPercent: 8.6, remainingPercent: 91.4 },
			windowModel: { usedPercent: 81.4, remainingPercent: 18.6, model: "gemini-2.5-flash", resetAtMs: Date.now() + 2 * 86_400_000 },
		},
	];

	const lines = renderAccountsModal(accounts, 0, 0, 60, 15).map(plain);
	const gemRow = lines.find((l) => l.includes("Gem"));
	assert.ok(gemRow, `expected a Gem row, got:\n${lines.join("\n")}`);
	assert.ok(gemRow.includes("81%"), "the model pool keeps its own percentage");
	assert.ok(lines.some((l) => l.includes("5h") && l.includes("0%")), "the 5h row stays at its published 0%");
});

test("renderAccountsModal marks a credential whose connection is failing", () => {
	const accounts: PamcAccountQuota[] = [
		{
			name: "antigravity-brevlux1@gmail.com.json",
			accountName: "brevlux1",
			provider: "antigravity",
			disabled: false,
			health: "error",
			healthMessage: "Verify your account to continue.",
			window5h: { usedPercent: 0, remainingPercent: 100 },
			windowWeekly: { usedPercent: 0, remainingPercent: 100 },
		},
	];

	const header = renderAccountsModal(accounts, 0, 0, 80, 15).map(plain).find((l) => l.includes("brevlux1"));
	assert.ok(header, "renders the account");
	assert.ok(header.includes("error"), `expected a connection error marker, got: ${header}`);
	assert.ok(!header.includes("activa"), "a failing credential is not painted as active");
});

test("renderQuotaMetric does not report a non-zero reading as 0%", () => {
	const metric = plain(renderQuotaMetric("Sem", 0.002, 0, 10));
	assert.ok(metric.includes("<1%"), `expected a sub-1% marker, got: ${metric}`);
	assert.ok(!metric.includes("0%"), "never claims zero when the reading is non-zero");
});

test("renderQuotaMetric still reports a true zero as 0%", () => {
	const metric = plain(renderQuotaMetric("Sem", 0, 0, 10));
	assert.ok(metric.includes("0%"));
});
