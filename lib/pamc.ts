import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PamcInfo } from "./panel-model.ts";
import type { PriceRates } from "./pricing.ts";

/** Default directory where CLIProxyAPI stores auth files. */
export function defaultPamcAuthsDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
	return env.PAMC_AUTHS_DIR?.trim() || join(home, "cliproxyapi", "auths");
}

/** True when CLIProxyAPI is configured in the agent home or explicitly configured via PAMC_AUTHS_DIR. */
export function isPamcConfigured(env: NodeJS.ProcessEnv = process.env, home = homedir()): boolean {
	if (env.PAMC_AUTHS_DIR?.trim()) return true;
	const agentDir = env.PI_CODING_AGENT_DIR || env.GENTLE_PI_AGENT_HOME || join(home, ".pi", "agent");
	return existsSync(join(agentDir, "cliproxyapi.json"));
}

/** Clean up account email or filename to a compact username representation. */
export function cleanAccountName(raw: string): string {
	return raw
		.replace(/^(antigravity|claude|codex|gemini|openai)-([a-f0-9]+-)?/i, "")
		.replace(/@.*$/, "")
		.replace(/\.json$/, "");
}

/** Asynchronously probes CLIProxyAPI TCP endpoint to verify live daemon availability without HTTP serialization overhead. */
export function checkPamcEndpoint(port = 18317, host = "127.0.0.1", timeoutMs = 2000): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ port, host });
		socket.setTimeout(timeoutMs);
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => {
			socket.destroy();
			resolve(false);
		});
		socket.once("timeout", () => {
			socket.destroy();
			resolve(false);
		});
	});
}

/** Watches auths directory for live credential changes and fires onChange callback debounced. */
export function watchPamcAuths(authsDir?: string, onChange: () => void = () => {}): FSWatcher | undefined {
	try {
		if (authsDir === undefined && !isPamcConfigured()) return undefined;
		const dir = authsDir ?? defaultPamcAuthsDir();
		if (!existsSync(dir)) return undefined;
		let debounce: NodeJS.Timeout | undefined;
		const watcher = watch(dir, () => {
			if (debounce) clearTimeout(debounce);
			debounce = setTimeout(() => {
				onChange();
			}, 100);
			debounce.unref?.();
		});
		return watcher;
	} catch {
		return undefined;
	}
}

/**
 * Reads CLIProxyAPI / Shell-PAMC auth files to obtain the count of active accounts
 * and identify the most recently used credential from file modification time.
 */
export function readPamcInfo(authsDir?: string, isOnline = true): PamcInfo | undefined {
	try {
		if (authsDir === undefined && !isPamcConfigured()) return undefined;
		const dir = authsDir ?? defaultPamcAuthsDir();
		if (!existsSync(dir)) return undefined;
		const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
		if (files.length === 0) return { state: "missing", active: 0, total: 0 };
		let active = 0;
		let latestMtime = 0;
		let latestAccount: string | undefined;

		for (const file of files) {
			try {
				const fullPath = join(dir, file);
				const stat = statSync(fullPath);
				const content = JSON.parse(readFileSync(fullPath, "utf8")) as Record<string, unknown>;
				const disabled = content.disabled === true || content.is_disabled === true || content.status === "disabled";
				if (!disabled) {
					active++;
					if (stat.mtimeMs > latestMtime) {
						latestMtime = stat.mtimeMs;
						const email = typeof content.email === "string" ? content.email : file;
						latestAccount = cleanAccountName(email);
					}
				}
			} catch {
				// Ignore unreadable or malformed files
			}
		}

		const state: PamcInfo["state"] = !isOnline ? "unreachable" : active > 0 ? "connected" : "missing";

		return {
			state,
			active,
			total: files.length,
			current: latestAccount,
		};
	} catch {
		return undefined;
	}
}

/** Reads pricing from Shell-PAMC HTTP API if available. */
export async function fetchPamcPrices(
	baseUrl = "http://127.0.0.1:18080/shell-pamc",
	password = "omc12345",
	timeoutMs = 1500,
): Promise<Record<string, PriceRates> | undefined> {
	try {
		let actualBase = baseUrl;
		let actualPass = password;
		const home = homedir();
		const configPath = join(home, ".gentle-shell", "omc-autoquota", "config.json");
		if (existsSync(configPath)) {
			try {
				const cfg = JSON.parse(readFileSync(configPath, "utf8")) as { baseUrl?: string; password?: string };
				if (cfg.baseUrl) actualBase = cfg.baseUrl;
				if (cfg.password) actualPass = cfg.password;
			} catch {}
		}

		const loginController = new AbortController();
		const loginTimer = setTimeout(() => loginController.abort(), timeoutMs);
		const loginRes = await fetch(`${actualBase}/api/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: actualPass }),
			signal: loginController.signal,
		});
		clearTimeout(loginTimer);
		if (!loginRes.ok) return undefined;

		const cookies = loginRes.headers.getSetCookie?.() ?? [];
		const cookie = cookies.map((c) => c.split(";")[0]).join("; ");

		const pricingController = new AbortController();
		const pricingTimer = setTimeout(() => pricingController.abort(), timeoutMs);
		const pricingRes = await fetch(`${actualBase}/api/v1/pricing`, {
			headers: { Cookie: cookie },
			signal: pricingController.signal,
		});
		clearTimeout(pricingTimer);
		if (!pricingRes.ok) return undefined;

		const data = (await pricingRes.json()) as {
			models?: Array<{
				model: string;
				prompt_price_per_1m: number;
				completion_price_per_1m: number;
				cache_read_price_per_1m: number;
				cache_write_price_per_1m: number;
				price_multiplier?: number;
			}>;
		};

		if (!Array.isArray(data.models)) return undefined;
		const result: Record<string, PriceRates> = {};
		for (const m of data.models) {
			const mult = typeof m.price_multiplier === "number" && m.price_multiplier > 0 ? m.price_multiplier : 1;
			result[m.model] = {
				input: m.prompt_price_per_1m * mult,
				output: m.completion_price_per_1m * mult,
				cacheRead: m.cache_read_price_per_1m * mult,
				cacheWrite: m.cache_write_price_per_1m * mult,
			};
		}
		return result;
	} catch {
		return undefined;
	}
}

/** Details of token quotas for an individual PAMC account. */
export interface PamcAccountQuota {
	name: string;
	accountName: string;
	provider: string;
	disabled: boolean;
	status?: string;
	window5h?: {
		usedPercent: number;
		remainingPercent: number;
		resetLabel?: string;
		resetAtMs?: number;
		tokens?: number;
	};
	windowWeekly?: {
		usedPercent: number;
		remainingPercent: number;
		resetLabel?: string;
		resetAtMs?: number;
		tokens?: number;
	};
	/**
	 * Antigravity publishes one pool per model group without a declared period.
	 * It is a different window from the 5h and weekly ones and must stay separate,
	 * otherwise a multi-day reset would be rendered inside a 5-hour bar.
	 */
	windowModel?: {
		usedPercent: number;
		remainingPercent: number;
		resetLabel?: string;
		resetAtMs?: number;
		tokens?: number;
		model?: string;
	};
	/** Connection health taken from the credential view, not from the quota view. */
	health?: "error";
	healthMessage?: string;
}

/** In-memory cache for fast instant modal opening */
let cachedPamcQuotas: PamcAccountQuota[] | undefined;
let cachedAuthCookie: string | undefined;
let lastCookieAt = 0;

export function getCachedPamcAccountQuotas(): PamcAccountQuota[] | undefined {
	return cachedPamcQuotas;
}

type QuotaWindowPayload = {
	id?: string;
	kind?: string;
	scope?: string;
	model?: string;
	period_hours?: number;
	used_percent?: number;
	remaining_percent?: number;
	reset_label?: string;
	reset_at_ms?: number;
	usage?: { tokens?: number };
};

type QuotaItemPayload = {
	name?: string;
	provider?: string;
	type?: string;
	disabled?: boolean;
	status?: string;
	windows?: QuotaWindowPayload[];
};

const MODEL_WINDOW_PREFIX = "ag_model_";

const roundPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value * 1000) / 1000));

function readQuotaWindow(window?: QuotaWindowPayload) {
	if (!window) return undefined;
	const remaining = typeof window.remaining_percent === "number" ? window.remaining_percent : 100;
	const usedPercent = roundPercent(typeof window.used_percent === "number" ? window.used_percent : Math.max(0, 100 - remaining));
	// 100% real tokens directly from published usage data. Never estimated or fabricated.
	const tokens = typeof window.usage?.tokens === "number" ? window.usage.tokens : undefined;
	return {
		usedPercent,
		remainingPercent: roundPercent(100 - usedPercent),
		resetLabel: window.reset_label,
		resetAtMs: window.reset_at_ms,
		tokens,
	};
}

const isModelScopedWindow = (window: QuotaWindowPayload) =>
	window.kind === "model_scoped" || window.scope === "model" || (window.id?.startsWith(MODEL_WINDOW_PREFIX) ?? false);

/**
 * Maps the Shell-PAMC quota payload onto the two declared periods plus, when the
 * provider publishes one, its model-scoped pool. A model-scoped pool has no
 * declared period, so it is never substituted into the 5h or weekly window.
 */
export function mapPamcQuotaPayload(payload: unknown): PamcAccountQuota[] | undefined {
	const items = (payload as { quotas?: QuotaItemPayload[] } | null | undefined)?.quotas;
	if (!Array.isArray(items)) return undefined;
	return items.map((item) => {
		const windows = Array.isArray(item.windows) ? item.windows : [];
		const shortWindow = windows.find((w) => typeof w.period_hours === "number" && w.period_hours <= 24);
		const longWindow = windows.find((w) => typeof w.period_hours === "number" && w.period_hours > 24);
		const modelWindow = windows.find(isModelScopedWindow);
		const account: PamcAccountQuota = {
			name: item.name ?? "",
			accountName: cleanAccountName(item.name ?? ""),
			provider: item.provider || item.type || "unknown",
			disabled: !!item.disabled,
			status: item.status,
			window5h: readQuotaWindow(shortWindow),
			windowWeekly: readQuotaWindow(longWindow),
		};
		const modelReading = readQuotaWindow(modelWindow);
		if (modelReading) {
			const model = modelWindow?.model ?? (modelWindow?.id?.startsWith(MODEL_WINDOW_PREFIX) ? modelWindow.id.slice(MODEL_WINDOW_PREFIX.length) : undefined);
			account.windowModel = { ...modelReading, model };
		}
		return account;
	});
}

function readHealthMessage(raw?: string): string | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string } | null;
		const message = parsed?.error?.message ?? parsed?.message;
		if (typeof message === "string" && message.trim()) return message.trim();
	} catch {
		if (raw.trim()) return raw.trim();
	}
	return undefined;
}

/** Marks the accounts whose credential view reports a connection error. */
export function mergePamcAuthHealth(quotas: PamcAccountQuota[], payload: unknown): PamcAccountQuota[] {
	const files = (payload as { files?: unknown } | null | undefined)?.files;
	if (!Array.isArray(files)) return quotas;
	const healthByName = new Map<string, { status?: string; message?: string }>();
	for (const entry of files) {
		if (!entry || typeof entry !== "object") continue;
		const file = entry as { name?: string; status?: string; status_message?: string };
		if (typeof file.name === "string") healthByName.set(file.name, { status: file.status, message: file.status_message });
	}
	return quotas.map((account) => {
		const health = healthByName.get(account.name);
		if (!health || health.status !== "error") return account;
		return { ...account, health: "error" as const, healthMessage: readHealthMessage(health.message) };
	});
}

async function fetchPamcAuthPayload(baseUrl: string, cookie: string): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 4000);
	try {
		const res = await fetch(`${baseUrl}/api/v1/management/auth-files`, {
			headers: { Cookie: cookie },
			signal: controller.signal,
		});
		if (!res.ok) return undefined;
		return (await res.json()) as unknown;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

/** Fetches real quota & usage data per account from Shell-PAMC /api/v1/management/quota. */
export async function fetchPamcAccountQuotas(
	baseUrl = "http://127.0.0.1:18080/shell-pamc",
	password = "omc12345",
	timeoutMs = 10000,
): Promise<PamcAccountQuota[] | undefined> {
	try {
		let actualBase = baseUrl;
		let actualPass = password;
		const home = homedir();
		const configPath = join(home, ".gentle-shell", "omc-autoquota", "config.json");
		if (existsSync(configPath)) {
			try {
				const cfg = JSON.parse(readFileSync(configPath, "utf8")) as { baseUrl?: string; password?: string };
				if (cfg.baseUrl) actualBase = cfg.baseUrl;
				if (cfg.password) actualPass = cfg.password;
			} catch {}
		}

		let cookie = cachedAuthCookie;
		const now = Date.now();
		if (!cookie || now - lastCookieAt > 300_000) {
			const loginController = new AbortController();
			const loginTimer = setTimeout(() => loginController.abort(), 4000);
			const loginRes = await fetch(`${actualBase}/api/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password: actualPass }),
				signal: loginController.signal,
			});
			clearTimeout(loginTimer);
			if (!loginRes.ok) return cachedPamcQuotas;

			const cookies = loginRes.headers.getSetCookie?.() ?? [];
			cookie = cookies.map((c) => c.split(";")[0]).join("; ");
			cachedAuthCookie = cookie;
			lastCookieAt = now;
		}

		const quotaController = new AbortController();
		const quotaTimer = setTimeout(() => quotaController.abort(), timeoutMs);
		const quotaRes = await fetch(`${actualBase}/api/v1/management/quota`, {
			headers: { Cookie: cookie },
			signal: quotaController.signal,
		});
		clearTimeout(quotaTimer);
		if (!quotaRes.ok) return cachedPamcQuotas;

		const data = (await quotaRes.json()) as {
			quotas?: Array<{
				name: string;
				provider?: string;
				type?: string;
				disabled?: boolean;
				status?: string;
				windows?: Array<{
					id?: string;
					period_hours?: number;
					used_percent?: number;
					remaining_percent?: number;
					reset_label?: string;
					reset_at_ms?: number;
					usage?: {
						tokens?: number;
					};
				}>;
			}>;
		};

		const quotas = mapPamcQuotaPayload(data);
		if (!quotas) return undefined;
		const withHealth = mergePamcAuthHealth(quotas, await fetchPamcAuthPayload(actualBase, cookie));

		cachedPamcQuotas = withHealth;
		return withHealth;
	} catch {
		return cachedPamcQuotas;
	}
}

/** Toggles an account between enabled/disabled in Shell-PAMC live. */
export async function togglePamcAccount(
	name: string,
	disabled: boolean,
	baseUrl = "http://127.0.0.1:18080/shell-pamc",
	password = "omc12345",
	timeoutMs = 3000,
): Promise<boolean> {
	try {
		let actualBase = baseUrl;
		let actualPass = password;
		const home = homedir();
		const configPath = join(home, ".gentle-shell", "omc-autoquota", "config.json");
		if (existsSync(configPath)) {
			try {
				const cfg = JSON.parse(readFileSync(configPath, "utf8")) as { baseUrl?: string; password?: string };
				if (cfg.baseUrl) actualBase = cfg.baseUrl;
				if (cfg.password) actualPass = cfg.password;
			} catch {}
		}

		const loginController = new AbortController();
		const loginTimer = setTimeout(() => loginController.abort(), timeoutMs);
		const loginRes = await fetch(`${actualBase}/api/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: actualPass }),
			signal: loginController.signal,
		});
		clearTimeout(loginTimer);
		if (!loginRes.ok) return false;

		const cookies = loginRes.headers.getSetCookie?.() ?? [];
		const cookie = cookies.map((c) => c.split(";")[0]).join("; ");

		const patchController = new AbortController();
		const patchTimer = setTimeout(() => patchController.abort(), timeoutMs);
		const patchRes = await fetch(`${actualBase}/api/v1/management/auth-files/status`, {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ name, disabled }),
			signal: patchController.signal,
		});
		clearTimeout(patchTimer);
		return patchRes.ok;
	} catch {
		return false;
	}
}



