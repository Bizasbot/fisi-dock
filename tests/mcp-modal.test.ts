import assert from "node:assert/strict";
import test from "node:test";
import { computeModalDimensions, extractServerDetails, renderMcpModal } from "../lib/mcp-modal.ts";
import type { McpServerInfo } from "../lib/panel-model.ts";

test("extractServerDetails maps servers and extracts matching tools", () => {
	const servers: McpServerInfo[] = [
		{ name: "codegraph", state: "connected" },
		{ name: "engram", state: "connected" },
		{ name: "fail-server", state: "failing" },
	];
	const tools = [
		{ name: "mcp__codegraph__explore", description: "explore code" },
		{ name: "mcp__engram__mem_save", description: "save memory" },
		{ name: "mcp__engram__mem_search", description: "search memory" },
		{ name: "other_tool", description: "unrelated" },
	];
	const details = extractServerDetails(servers, tools);
	assert.equal(details.length, 3);
	assert.equal(details[0].name, "codegraph");
	assert.equal(details[0].state, "connected");
	assert.deepEqual(details[0].tools, [{ name: "explore", description: "explore code" }]);

	assert.equal(details[1].name, "engram");
	assert.equal(details[1].tools.length, 2);

	assert.equal(details[2].name, "fail-server");
	assert.equal(details[2].state, "failing");
	assert.equal(details[2].tools.length, 0);
});

test("computeModalDimensions clamps width and height within terminal bounds", () => {
	const dims = computeModalDimensions(100, 40);
	assert.ok(dims.width <= 74);
	assert.ok(dims.height <= 28);
	assert.ok(dims.left >= 0);
	assert.ok(dims.top >= 1);
});

test("renderMcpModal produces formatted lines with title, servers and tools", () => {
	const details = [
		{ name: "engram", state: "connected" as const, tools: [{ name: "mem_save" }, { name: "mem_search" }] },
		{ name: "gopls", state: "failing" as const, tools: [] },
	];
	const lines = renderMcpModal(details, 0, 0, 60, 16);
	assert.ok(lines.length > 0);
	const text = lines.join("\n");
	assert.ok(text.includes("Visor de Servidores MCP"));
	assert.ok(text.includes("engram"));
	assert.ok(text.includes("mem_save"));
	assert.ok(text.includes("gopls"));
	assert.ok(text.includes("fallando"));
});
