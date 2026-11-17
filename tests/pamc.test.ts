import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkPamcEndpoint, cleanAccountName, mapPamcQuotaPayload, mergePamcAuthHealth, readPamcInfo, watchPamcAuths } from "../lib/pamc.ts";
import { renderPanel } from "../lib/panel.ts";
import type { PanelModel } from "../lib/panel-model.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

test("cleanAccountName strips prefixes, domains, and extensions", () => {
	assert.equal(cleanAccountName("antigravity-amartinez140482@gmail.com.json"), "amartinez140482");
	assert.equal(cleanAccountName("claude-afa4fac0-inversionesmybrd@gmail.com.json"), "inversionesmybrd");
	assert.equal(cleanAccountName("codex-3128957b-myaccount@domain.org"), "myaccount");
	assert.equal(cleanAccountName("direct-user@test.com"), "direct-user");
});

test("checkPamcEndpoint: resolves true when server listens, false when closed", async () => {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;

	try {
		const isListening = await checkPamcEndpoint(port, "127.0.0.1", 500);
		assert.equal(isListening, true, "open port connects");
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	const isClosed = await checkPamcEndpoint(port, "127.0.0.1", 200);
	assert.equal(isClosed, false, "closed port returns false");
});

test("readPamcInfo: missing directory returns undefined", () => {
	const nonExistent = join(tmpdir(), `pamc-missing-${Date.now()}`);
	assert.equal(readPamcInfo(nonExistent), undefined);
});

test("readPamcInfo: empty directory returns missing state", () => {
	const emptyDir = join(tmpdir(), `pamc-empty-${Date.now()}`);
	mkdirSync(emptyDir, { recursive: true });
	try {
		assert.deepEqual(readPamcInfo(emptyDir), { state: "missing", active: 0, total: 0 });
	} finally {
		rmSync(emptyDir, { recursive: true, force: true });
	}
});

test("readPamcInfo: calculates active accounts and latest used account by mtime", async () => {
	const testDir = join(tmpdir(), `pamc-test-${Date.now()}`);
	mkdirSync(testDir, { recursive: true });
	try {
		const file1 = join(testDir, "antigravity-user1@gmail.com.json");
		const file2 = join(testDir, "antigravity-user2@gmail.com.json");
		const file3 = join(testDir, "antigravity-disabled@gmail.com.json");

		writeFileSync(file1, JSON.stringify({ disabled: false, email: "user1@gmail.com" }));
		await new Promise((r) => setTimeout(r, 15));
		writeFileSync(file2, JSON.stringify({ disabled: false, email: "user2@gmail.com" }));
		await new Promise((r) => setTimeout(r, 15));
		writeFileSync(file3, JSON.stringify({ disabled: true, email: "disabled@gmail.com" }));

		const info = readPamcInfo(testDir, true);
		assert.ok(info);
		assert.equal(info.state, "connected");
		assert.equal(info.active, 2);
		assert.equal(info.total, 3);
		assert.equal(info.current, "user2");

		const offline = readPamcInfo(testDir, false);
		assert.ok(offline);
		assert.equal(offline.state, "unreachable");
	} finally {
		rmSync(testDir, { recursive: true, force: true });
	}
});

test("watchPamcAuths triggers onChange callback on directory mutation", async () => {
	const testDir = join(tmpdir(), `pamc-watch-${Date.now()}`);
	mkdirSync(testDir, { recursive: true });
	let triggered = false;
	const watcher = watchPamcAuths(testDir, () => {
		triggered = true;
	});
	try {
		assert.ok(watcher);
		// On Windows, fs.watch may take slightly more than 200ms with debounce
		await new Promise((r) => setTimeout(r, 50));
		writeFileSync(join(testDir, "antigravity-new@gmail.com.json"), JSON.stringify({ disabled: false }));
		for (let i = 0; i < 10; i++) {
			await new Promise((r) => setTimeout(r, 50));
			if (triggered) break;
		}
		assert.equal(triggered, true);
	} finally {
		watcher?.close();
		rmSync(testDir, { recursive: true, force: true });
	}
});

test("renderPanel renders pamc row with user and connected status", () => {
	const model: PanelModel = {
		session: {
			project: "my-project",
			memory: { state: "connected", saved: 3 },
			pamc: { state: "connected", active: 18, total: 25, current: "krenkel02399188" },
			mcp: [{ name: "codegraph", state: "connected" }],
		},
	};

	// At 55 columns
	const lines55 = renderPanel(model, 55).map(plain);
	const pamcLine55 = lines55.find((line) => line.includes("pamc"));
	assert.ok(pamcLine55, "pamc row rendered at 55");
	assert.ok(pamcLine55.includes("krenkel"), "user visible at 55");

	// At tight 47 columns (inner 43)
	const lines47 = renderPanel(model, 47).map(plain);
	const pamcLine47 = lines47.find((line) => line.includes("pamc"));
	assert.ok(pamcLine47, "pamc row rendered at 47");
	assert.ok(pamcLine47.includes("connected"), "connected ALWAYS visible at 47");

	// At 40 columns
	const lines40 = renderPanel(model, 40).map(plain);
	const pamcLine40 = lines40.find((line) => line.includes("pamc"));
	assert.ok(pamcLine40, "pamc row rendered at 40");
	assert.ok(pamcLine40.includes("connected"), "connected ALWAYS visible at 40");
});

test("renderPanel preserves user even when unreachable / disconnected", () => {
	const model: PanelModel = {
		session: {
			project: "my-project",
			pamc: { state: "unreachable", active: 18, total: 25, current: "krenkel02399188" },
		},
	};

	const lines = renderPanel(model, 47).map(plain);
	const pamcLine = lines.find((line) => line.includes("pamc"));
	assert.ok(pamcLine, "pamc row should be rendered");
	assert.ok(pamcLine.includes("unreachable"), "should include unreachable status");
	assert.ok(pamcLine.includes("✗"), "should include disconnected glyph");
	assert.ok(pamcLine.includes("krenkel"), "user preserved");
});

// --- Antigravity window mapping: a model-scoped pool must not impersonate the 5h window ---

const antigravityPayload = {
	quotas: [
		{
			name: "antigravity-zynxedit10@gmail.com.json",
			provider: "antigravity",
			disabled: false,
			status: "idle",
			windows: [
				{ id: "ag_Claude and GPT models_3p-5h", period_hours: 5, used_percent: 0, remaining_percent: 100, reset_at_ms: 1000, reset_label: "09:14" },
				{ id: "ag_Claude and GPT models_3p-weekly", period_hours: 168, used_percent: 0.00196, remaining_percent: 99.99804, reset_at_ms: 2000, reset_label: "11-16 21:31" },
				{ id: "ag_model_gemini-2.5-flash", kind: "model_scoped", scope: "model", used_percent: 81.356919, remaining_percent: 18.643081, reset_at_ms: 3000, reset_label: "2天22小时后恢复" },
			],
		},
	],
};

test("mapPamcQuotaPayload: the model-scoped pool never fills the 5h window", () => {
	const mapped = mapPamcQuotaPayload(antigravityPayload);
	assert.ok(mapped && mapped.length === 1);
	const acc = mapped[0];
	assert.equal(acc.window5h?.usedPercent, 0, "5h window keeps its published 0%");
	assert.equal(acc.window5h?.resetAtMs, 1000, "5h window keeps its own reset");
	assert.ok(Math.abs((acc.windowModel?.usedPercent ?? 0) - 81.356919) < 0.001, "model pool is exposed on its own field");
	assert.equal(acc.windowModel?.resetAtMs, 3000, "model pool keeps its own reset");
	assert.equal(acc.windowModel?.model, "gemini-2.5-flash");
});

test("mapPamcQuotaPayload: a sub-1% weekly reading is not flattened to zero", () => {
	const mapped = mapPamcQuotaPayload(antigravityPayload);
	assert.ok(mapped);
	const weekly = mapped[0].windowWeekly?.usedPercent ?? -1;
	assert.ok(weekly > 0, `weekly keeps a non-zero reading, got ${weekly}`);
});

test("mapPamcQuotaPayload: rejects a payload without quotas", () => {
	assert.equal(mapPamcQuotaPayload({}), undefined);
	assert.equal(mapPamcQuotaPayload(null), undefined);
});

test("mergePamcAuthHealth: marks 403 credentials as connection errors", () => {
	const mapped = mapPamcQuotaPayload(antigravityPayload);
	assert.ok(mapped);
	const files = [
		{
			name: "antigravity-zynxedit10@gmail.com.json",
			status: "error",
			unavailable: true,
			status_message: JSON.stringify({ error: { code: 403, message: "Verify your account to continue." } }),
		},
	];
	const merged = mergePamcAuthHealth(mapped, { files });
	assert.equal(merged[0].health, "error");
	assert.ok((merged[0].healthMessage ?? "").includes("Verify your account"));
});

test("mergePamcAuthHealth: leaves healthy credentials unmarked", () => {
	const mapped = mapPamcQuotaPayload(antigravityPayload);
	assert.ok(mapped);
	const merged = mergePamcAuthHealth(mapped, { files: [{ name: "antigravity-zynxedit10@gmail.com.json", status: "active" }] });
	assert.equal(merged[0].health, undefined);
});

test("mergePamcAuthHealth: tolerates a missing or malformed auth payload", () => {
	const mapped = mapPamcQuotaPayload(antigravityPayload);
	assert.ok(mapped);
	assert.equal(mergePamcAuthHealth(mapped, undefined)[0].health, undefined);
	assert.equal(mergePamcAuthHealth(mapped, { files: "nope" })[0].health, undefined);
});
