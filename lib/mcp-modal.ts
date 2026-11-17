import type { McpServerInfo } from "./panel-model.ts";
import { bold, fg, palette } from "./palette.ts";
import { ellipsize, padEnd, visibleWidth } from "./text.ts";
import { mcpNamespace } from "./mcp.ts";

const muted = (text: string) => fg(palette.muted, text);

export interface ModalDimensions {
	width: number;
	height: number;
	top: number;
	left: number;
}

export function computeModalDimensions(termWidth: number, termHeight: number): ModalDimensions {
	const width = Math.max(42, Math.min(74, termWidth - 4));
	const height = Math.max(12, Math.min(28, termHeight - 4));
	const left = Math.max(0, Math.floor((termWidth - width) / 2));
	const top = Math.max(1, Math.floor((termHeight - height) / 2));
	return { width, height, top, left };
}

export interface McpServerDetail {
	name: string;
	state: "connected" | "unknown" | "failing";
	tools: Array<{ name: string; description?: string }>;
}

export function extractServerDetails(servers: McpServerInfo[], allTools: unknown[]): McpServerDetail[] {
	const toolList = Array.isArray(allTools) ? allTools : [];
	return servers.map((server) => {
		const ns = mcpNamespace(server.name);
		const prefix = `${ns}__`;
		const ownTools = toolList
			.filter((t) => {
				if (!t || typeof t !== "object") return false;
				const tool = t as { name?: unknown; namespace?: { name?: unknown } };
				return (typeof tool.name === "string" && tool.name.startsWith(prefix)) || tool.namespace?.name === ns;
			})
			.map((t) => {
				const tool = t as { name: string; description?: string };
				const shortName = tool.name.startsWith(prefix) ? tool.name.slice(prefix.length) : tool.name;
				return { name: shortName, description: tool.description };
			});

		return {
			name: server.name,
			state: server.state,
			tools: ownTools,
		};
	});
}

/**
 * Renders the MCP servers modal visor.
 * Shows all MCP servers, status badges, connection health, and tools provided.
 */
export function renderMcpModal(
	servers: McpServerDetail[],
	selectedIndex: number,
	scrollOffset: number,
	width: number,
	maxRows: number,
): string[] {
	const innerWidth = width - 4;
	const lines: string[] = [];

	const connectedCount = servers.filter((s) => s.state === "connected").length;
	const failingCount = servers.filter((s) => s.state === "failing").length;
	const connectingCount = servers.filter((s) => s.state === "unknown").length;

	// Top frame with title
	const title = bold(fg(palette.pink, " ✦ Visor de Servidores MCP ✦ "));
	const titleWidth = visibleWidth(title);
	const ruleRightLen = Math.max(0, width - 2 - 2 - titleWidth);
	lines.push(fg(palette.pink, "╭─") + title + fg(palette.pink, "─".repeat(ruleRightLen) + "╮"));

	// Subtitle summary row
	const summaryParts = [
		`${servers.length} servidores`,
		fg(palette.green, `${connectedCount} conectados`),
		...(failingCount > 0 ? [fg(palette.red, `${failingCount} fallando`)] : []),
		...(connectingCount > 0 ? [fg(palette.amber, `${connectingCount} conectando`)] : []),
	];
	const subHeader = "  " + summaryParts.join(muted(" · "));
	lines.push(fg(palette.pink, "│ ") + padEnd(ellipsize(subHeader, innerWidth), innerWidth) + fg(palette.pink, " │"));
	lines.push(fg(palette.pink, "│ ") + muted("─".repeat(innerWidth)) + fg(palette.pink, " │"));

	if (servers.length === 0) {
		const msg = "No hay servidores MCP configurados en mcp.json";
		lines.push(fg(palette.pink, "│ ") + padEnd(muted(msg), innerWidth) + fg(palette.pink, " │"));
		while (lines.length < maxRows - 1) {
			lines.push(fg(palette.pink, "│ ") + " ".repeat(innerWidth) + fg(palette.pink, " │"));
		}
		lines.push(fg(palette.pink, "╰" + "─".repeat(width - 2) + "╯"));
		return lines;
	}

	// Each server takes 2 lines (header + tools list)
	const itemHeight = 2;
	const availableRows = maxRows - 4; // top frame, subtitle, divider, bottom frame
	const visibleCount = Math.max(1, Math.floor(availableRows / itemHeight));
	const startIdx = Math.max(0, Math.min(scrollOffset, Math.max(0, servers.length - visibleCount)));
	const endIdx = Math.min(servers.length, startIdx + visibleCount);

	for (let i = startIdx; i < endIdx; i++) {
		const s = servers[i];
		const isSelected = i === selectedIndex;

		let glyph: string;
		let badge: string;
		if (s.state === "connected") {
			glyph = fg(palette.green, "●");
			badge = fg(palette.green, "conectado");
		} else if (s.state === "failing") {
			glyph = fg(palette.red, "✗");
			badge = fg(palette.red, "fallando");
		} else {
			glyph = fg(palette.amber, "◌");
			badge = fg(palette.amber, "conectando");
		}

		const pointer = isSelected ? fg(palette.pink, "› ") : "  ";
		const nameText = isSelected ? bold(fg(palette.text, s.name)) : fg(palette.text, s.name);
		const toolsCount = s.tools.length > 0 ? muted(`(${s.tools.length} herramientas)`) : muted("(sin herramientas)");

		const line1 = `${pointer}${glyph} ${nameText} ${muted("·")} ${badge} ${toolsCount}`;
		lines.push(fg(palette.pink, "│ ") + padEnd(ellipsize(line1, innerWidth), innerWidth) + fg(palette.pink, " │"));

		// Tools row
		let line2: string;
		if (s.tools.length > 0) {
			const toolNames = s.tools.map((t) => t.name).join(", ");
			line2 = `    ${muted("tools: ")}${fg(palette.text, toolNames)}`;
		} else if (s.state === "failing") {
			line2 = `    ${fg(palette.red, "error: sin herramientas registradas tras período de gracia")}`;
		} else {
			line2 = `    ${muted("esperando registro de herramientas...")}`;
		}
		lines.push(fg(palette.pink, "│ ") + padEnd(ellipsize(line2, innerWidth), innerWidth) + fg(palette.pink, " │"));
	}

	// Fill remaining height
	while (lines.length < maxRows - 1) {
		lines.push(fg(palette.pink, "│ ") + " ".repeat(innerWidth) + fg(palette.pink, " │"));
	}

	// Bottom rule with navigation hint
	const hint = muted(` ${selectedIndex + 1}/${servers.length} · ↑/↓ navega · Esc cierra `);
	const hintWidth = visibleWidth(hint);
	const bottomRuleLen = Math.max(0, width - 2 - hintWidth);
	lines.push(fg(palette.pink, "╰" + "─".repeat(Math.floor(bottomRuleLen / 2))) + hint + fg(palette.pink, "─".repeat(Math.ceil(bottomRuleLen / 2)) + "╯"));

	return lines;
}
