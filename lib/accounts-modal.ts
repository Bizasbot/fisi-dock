import type { PamcAccountQuota } from "./pamc.ts";
import { formatTokens, contextGaugeColor, contextMeter } from "./panel.ts";
import { bold, fg, palette } from "./palette.ts";
import { ellipsize, padEnd, visibleWidth } from "./text.ts";

const muted = (text: string) => fg(palette.muted, text);

export type ModalTab = "active" | "inactive";

export interface ModalDimensions {
	width: number;
	height: number;
	top: number;
	left: number;
}

export function computeModalDimensions(termWidth: number, termHeight: number): ModalDimensions {
	const width = Math.max(Math.min(46, termWidth), Math.min(64, termWidth - 4));
	const height = Math.max(Math.min(10, termHeight), Math.min(16, termHeight - 4));
	const left = Math.max(0, Math.floor((termWidth - width) / 2));
	const top = Math.max(0, Math.floor((termHeight - height) / 2));
	return { width, height, top, left };
}

export function frameModalBackdrop(
	boxLines: string[],
	boxWidth: number,
	termWidth: number,
	termHeight: number,
	top: number,
	left: number,
): string[] {
	const lines: string[] = [];
	const safeWidth = Math.max(1, termWidth);
	const emptyRow = " ".repeat(safeWidth);
	const padLeftLen = Math.max(0, left);
	const padRightLen = Math.max(0, safeWidth - padLeftLen - boxWidth);
	const padLeft = " ".repeat(padLeftLen);
	const padRight = " ".repeat(padRightLen);

	for (let i = 0; i < top && lines.length < termHeight; i++) {
		lines.push(emptyRow);
	}
	for (const line of boxLines) {
		if (lines.length >= termHeight) break;
		lines.push(padLeft + line + padRight);
	}
	while (lines.length < termHeight) {
		lines.push(emptyRow);
	}
	return lines;
}

function providerBadge(provider: string): string {
	const p = provider.toLowerCase();
	if (p.includes("claude") || p.includes("anthropic")) {
		return fg([249, 115, 22], "Claude");
	}
	if (p.includes("codex") || p.includes("openai") || p.includes("chatgpt")) {
		return fg([16, 185, 129], "Codex");
	}
	if (p.includes("gemini") || p.includes("google")) {
		return fg([59, 130, 246], "Gemini");
	}
	if (p.includes("antigravity")) {
		return fg([14, 165, 233], "Antigravity");
	}
	return fg(palette.teal, provider.slice(0, 11));
}

export function formatResetCountdown(resetAtMs?: number, resetLabel?: string): string {
	if (typeof resetAtMs === "number" && resetAtMs > 0) {
		const diff = resetAtMs - Date.now();
		if (diff > 0) {
			const totalSeconds = Math.floor(diff / 1000);
			const days = Math.floor(totalSeconds / 86400);
			const hours = Math.floor((totalSeconds % 86400) / 3600);
			const minutes = Math.floor((totalSeconds % 3600) / 60);

			if (days > 0) {
				return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
			}
			if (hours > 0) {
				return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
			}
			return `${Math.max(1, minutes)}m`;
		}
	}
	if (!resetLabel) return "";
	const dMatch = resetLabel.match(/(\d+)\s*天/);
	const hMatch = resetLabel.match(/(\d+)\s*小时/);
	const mMatch = resetLabel.match(/(\d+)\s*分/);
	const parts: string[] = [];
	if (dMatch) parts.push(`${dMatch[1]}d`);
	if (hMatch) parts.push(`${hMatch[1]}h`);
	if (mMatch && !dMatch) parts.push(`${mMatch[1]}m`);
	return parts.join(" ");
}

export function renderQuotaMetric(
	label: string,
	usedPercent: number,
	tokens?: number,
	barCells = 16,
	resetAtMs?: number,
	resetLabel?: string,
	showTokens = false,
): string {
	const pct = Math.max(0, Math.min(100, Math.round(usedPercent)));
	const color = contextGaugeColor(pct);
	const meter = contextMeter(pct, barCells);
	// A published reading below one percent is not a zero: flattening it would hide real usage.
	const pctLabel = pct === 0 && usedPercent > 0 ? "<1%" : `${pct}%`;
	const pctStr = bold(fg(color, pctLabel));
	const tokStr = showTokens && tokens !== undefined && tokens > 0 ? muted(` (${formatTokens(tokens)} tok)`) : "";
	const countdown = formatResetCountdown(resetAtMs, resetLabel);
	const countdownStr = countdown ? fg(palette.amber, ` · ⟳ ${countdown}`) : "";
	return `${muted(label.padEnd(5))} ${meter} ${pctStr}${tokStr}${countdownStr}`;
}

export function renderAccountsModal(
	accounts: PamcAccountQuota[],
	selectedIndex: number,
	scrollOffset: number,
	width: number,
	maxRows: number,
	loading = false,
	activeTab: ModalTab = "active",
	toggling = false,
	actionAccountIndex: number | null = null,
	showTokens = false,
): string[] {
	const innerWidth = width - 4;
	const lines: string[] = [];

	const activeList = accounts.filter((a) => !a.disabled);
	const inactiveList = accounts.filter((a) => a.disabled);

	// Sort active accounts by real token consumption and pressure:
	// 1. Current 5h window active usage (percentage and tokens)
	// 2. Real cumulative tokens consumed (100% verified volume)
	// 3. Weekly quota usage percentage
	// 4. Model pool usage percentage
	// 5. Account name alphabetically
	activeList.sort((a, b) => {
		const a5hPct = a.window5h?.usedPercent ?? 0;
		const b5hPct = b.window5h?.usedPercent ?? 0;
		if (Math.abs(a5hPct - b5hPct) > 0.0001) return b5hPct - a5hPct;

		const a5hTok = a.window5h?.tokens ?? 0;
		const b5hTok = b.window5h?.tokens ?? 0;
		if (a5hTok !== b5hTok) return b5hTok - a5hTok;

		const aWkTok = a.windowWeekly?.tokens ?? 0;
		const bWkTok = b.windowWeekly?.tokens ?? 0;
		if (aWkTok !== bWkTok) return bWkTok - aWkTok;

		const aWkPct = a.windowWeekly?.usedPercent ?? 0;
		const bWkPct = b.windowWeekly?.usedPercent ?? 0;
		if (Math.abs(aWkPct - bWkPct) > 0.0001) return bWkPct - aWkPct;

		const aModPct = a.windowModel?.usedPercent ?? 0;
		const bModPct = b.windowModel?.usedPercent ?? 0;
		if (Math.abs(aModPct - bModPct) > 0.0001) return bModPct - aModPct;

		return a.accountName.localeCompare(b.accountName);
	});

	inactiveList.sort((a, b) => a.accountName.localeCompare(b.accountName));

	const currentList = activeTab === "active" ? activeList : inactiveList;

	// Tabs bar on the top frame: SHELL PAMC without brackets
	const activeTabLabel = activeTab === "active"
		? bold(fg([255, 255, 255], `● Activas en Uso (${activeList.length})`))
		: muted(`○ Activas (${activeList.length})`);

	const inactiveTabLabel = activeTab === "inactive"
		? bold(fg(palette.pink, `● Inactivas (${inactiveList.length})`))
		: muted(`○ Inactivas (${inactiveList.length})`);

	const tabsHeader = ` ✦ SHELL PAMC · ${activeTabLabel} ${muted("│")} ${inactiveTabLabel} `;
	const tabsWidth = visibleWidth(tabsHeader);
	const ruleRightLen = Math.max(0, width - 3 - tabsWidth);
	lines.push(fg(palette.pink, "╭─") + tabsHeader + fg(palette.pink, "─".repeat(ruleRightLen) + "╮"));

	// Sub-bar hint for actions: clean, with dynamic action menu on right-click
	let subHint: string;
	if (toggling) {
		subHint = fg(palette.amber, "  Sincronizando cambio con Shell-PAMC...");
	} else if (actionAccountIndex !== null && currentList[actionAccountIndex]) {
		const targetAcc = currentList[actionAccountIndex];
		const name = ellipsize(targetAcc.accountName, 16);
		const actBtn = bold(fg(palette.green, "[✓ Activar]"));
		const deactBtn = bold(fg(palette.pink, "[✗ Desactivar]"));
		const cancelBtn = muted("[✕]");
		subHint = `  ▶ ${bold(name)}: ${actBtn}  ${deactBtn}  ${cancelBtn}`;
	} else {
		subHint = muted(`  Tab cambia pestaña · a activar · d desactivar`);
	}
	lines.push(fg(palette.pink, "│ ") + padEnd(ellipsize(subHint, innerWidth), innerWidth) + fg(palette.pink, " │"));
	lines.push(fg(palette.pink, "│ ") + muted("─".repeat(innerWidth)) + fg(palette.pink, " │"));

	if (loading && accounts.length === 0) {
		const msg = "Consultando cuotas en línea a Shell-PAMC...";
		const pad = Math.max(0, Math.floor((innerWidth - visibleWidth(msg)) / 2));
		lines.push(fg(palette.pink, "│ ") + " ".repeat(pad) + muted(msg) + " ".repeat(Math.max(0, innerWidth - pad - visibleWidth(msg))) + fg(palette.pink, " │"));
		while (lines.length < maxRows - 1) {
			lines.push(fg(palette.pink, "│ ") + " ".repeat(innerWidth) + fg(palette.pink, " │"));
		}
		lines.push(fg(palette.pink, "╰" + "─".repeat(width - 2) + "╯"));
		return lines;
	}

	if (currentList.length === 0) {
		const msg = activeTab === "active" ? "No hay cuentas activas en Shell-PAMC" : "No hay cuentas inactivas en Shell-PAMC";
		lines.push(fg(palette.pink, "│ ") + padEnd(muted(msg), innerWidth) + fg(palette.pink, " │"));
		while (lines.length < maxRows - 1) {
			lines.push(fg(palette.pink, "│ ") + " ".repeat(innerWidth) + fg(palette.pink, " │"));
		}
		lines.push(fg(palette.pink, "╰" + "─".repeat(width - 2) + "╯"));
		return lines;
	}

	// One header row plus one row per window: 5h, weekly and the provider's model pool.
	const itemHeight = 4;
	const availableRows = maxRows - 4;
	const visibleCount = Math.max(1, Math.floor(availableRows / itemHeight));
	const clampedSelected = Math.max(0, Math.min(currentList.length - 1, selectedIndex));
	const startIdx = Math.max(0, Math.min(scrollOffset, Math.max(0, currentList.length - visibleCount)));
	const endIdx = Math.min(currentList.length, startIdx + visibleCount);

	const barCells = Math.max(8, Math.min(18, innerWidth - 26));

	for (let i = startIdx; i < endIdx; i++) {
		const acc = currentList[i];
		const isSelected = i === clampedSelected;
		const isActionTarget = i === actionAccountIndex;
		const failing = acc.health === "error";
		const activeGlyph = failing
			? fg(palette.red, "▲")
			: acc.disabled
				? fg(palette.muted, "○")
				: fg(palette.green, "●");
		const statusText = failing
			? fg(palette.red, "error")
			: acc.disabled
				? fg(palette.muted, "inactiva")
				: fg(palette.green, "activa");
		const name = isSelected ? bold(fg(palette.text, acc.accountName)) : fg(palette.text, acc.accountName);
		const badge = providerBadge(acc.provider);

		const pointer = isSelected ? fg(palette.pink, "› ") : "  ";
		let headerRow: string;
		if (isActionTarget) {
			const actBtn = bold(fg(palette.green, "[✓ Activar]"));
			const deactBtn = bold(fg(palette.pink, "[✗ Desactivar]"));
			headerRow = `${pointer}${activeGlyph} ${name} · ${actBtn} ${deactBtn}`;
		} else {
			headerRow = `${pointer}${activeGlyph} ${name} ${muted("·")} ${badge} ${muted("·")} ${statusText}`;
		}
		lines.push(fg(palette.pink, "│ ") + padEnd(ellipsize(headerRow, innerWidth), innerWidth) + fg(palette.pink, " │"));

		// 5h Window metric with reset countdown
		const u5h = acc.window5h?.usedPercent ?? 0;
		const tok5h = acc.window5h?.tokens;
		const r5hMs = acc.window5h?.resetAtMs;
		const r5hLbl = acc.window5h?.resetLabel;
		const m5h = `    ${renderQuotaMetric("5h", u5h, tok5h, barCells, r5hMs, r5hLbl, showTokens)}`;
		lines.push(fg(palette.pink, "│ ") + padEnd(ellipsize(m5h, innerWidth), innerWidth) + fg(palette.pink, " │"));

		// Weekly Window metric with days reset countdown
		const uwk = acc.windowWeekly?.usedPercent ?? 0;
		const tokWk = acc.windowWeekly?.tokens;
		const rWkMs = acc.windowWeekly?.resetAtMs;
		const rWkLbl = acc.windowWeekly?.resetLabel;
		const mWk = `    ${renderQuotaMetric("Sem", uwk, tokWk, barCells, rWkMs, rWkLbl, showTokens)}`;
		lines.push(fg(palette.pink, "│ ") + padEnd(ellipsize(mWk, innerWidth), innerWidth) + fg(palette.pink, " │"));

		// Model-scoped pool: Antigravity publishes one per model group with no declared period.
		// It gets its own row and its own reset so a multi-day countdown never sits in the 5h bar.
		const um = acc.windowModel?.usedPercent;
		if (um !== undefined) {
			const mM = `    ${renderQuotaMetric("Gem", um, acc.windowModel?.tokens, barCells, acc.windowModel?.resetAtMs, acc.windowModel?.resetLabel, showTokens)}`;
			lines.push(fg(palette.pink, "│ ") + padEnd(ellipsize(mM, innerWidth), innerWidth) + fg(palette.pink, " │"));
		} else {
			lines.push(fg(palette.pink, "│ ") + " ".repeat(innerWidth) + fg(palette.pink, " │"));
		}
	}

	// Fill remaining height
	while (lines.length < maxRows - 1) {
		lines.push(fg(palette.pink, "│ ") + " ".repeat(innerWidth) + fg(palette.pink, " │"));
	}

	// Bottom rule with navigation hint
	const hint = muted(` ${clampedSelected + 1}/${currentList.length} · ↑/↓ navega · Esc/clic der cierra `);
	const hintWidth = visibleWidth(hint);
	const bottomRuleLen = Math.max(0, width - 2 - hintWidth);
	lines.push(fg(palette.pink, "╰" + "─".repeat(Math.floor(bottomRuleLen / 2))) + hint + fg(palette.pink, "─".repeat(Math.ceil(bottomRuleLen / 2)) + "╯"));

	return lines;
}
