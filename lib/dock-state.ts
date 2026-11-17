import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Where `/fisi-dock on|off` is remembered across restarts (S95): Pi's agent dir
 * (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`), outside any repository.
 */
export function dockStatePath(env: Record<string, string | undefined>, home: string): string {
	return join(env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent"), "fisi-dock", "state.json");
}

function readState(path: string): Record<string, unknown> | undefined {
	try {
		const state = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return state && typeof state === "object" && !Array.isArray(state) ? (state as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

/** Off only when the file says `"enabled": false`; a missing, unreadable or malformed file means on. */
export function readDockEnabled(path: string): boolean {
	return readState(path)?.enabled !== false;
}

/** The theme in use before `/fisi-dock on` (S7), for off to put back; undefined unless a non-empty string. */
export function readDockTheme(path: string): string | undefined {
	const theme = readState(path)?.theme;
	return typeof theme === "string" && theme !== "" ? theme : undefined;
}

/** Whether the first start already applied the Fisi-Dock theme once (T9): only `"themeApplied": true` says so. */
export function readDockThemeApplied(path: string): boolean {
	return readState(path)?.themeApplied === true;
}

/**
 * Saves `{ "enabled": …, "theme": …, "themeApplied": true }` (no theme key without one, no
 * themeApplied key unless true), creating its folder. False when it could not be written.
 */
export function writeDockEnabled(path: string, enabled: boolean, theme?: string, themeApplied = false): boolean {
	try {
		const mcpExpanded = readState(path)?.mcpExpanded;
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify({ enabled, ...(theme ? { theme } : {}), ...(themeApplied ? { themeApplied } : {}), ...(mcpExpanded !== undefined ? { mcpExpanded } : {}) })}\n`);
		return true;
	} catch {
		return false;
	}
}

/** Whether the MCP dropdown is expanded on the rail; false (collapsed) by default. */
export function readMcpExpanded(path: string): boolean {
	return readState(path)?.mcpExpanded === true;
}

/** Saves the MCP dropdown state `{ "mcpExpanded": … }` preserving existing state properties. */
export function writeMcpExpanded(path: string, mcpExpanded: boolean): boolean {
	try {
		const current = readState(path) ?? {};
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify({ ...current, mcpExpanded })}\n`);
		return true;
	} catch {
		return false;
	}
}

