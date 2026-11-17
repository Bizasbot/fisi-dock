// API-price estimate for sessions that record tokens but no cost (S37): a
// Claude subscription through pi-claude-bridge registers Anthropic's catalog
// with every price set to 0. Prices come from Pi's own model registry
// (ctx.modelRegistry.find -> Model.cost, dollars per million tokens), never
// from a table kept here.

export interface PriceRates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Pi's ModelCostTier: other rates once a message's input passes `inputTokensAbove`. */
	tiers?: (Omit<PriceRates, "tiers"> & { inputTokensAbove: number })[];
}

/** The price of a message's model; undefined when none is known. */
export type PriceLookup = (provider: string | undefined, model: string) => PriceRates | undefined;

export interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Subset of cacheWrite kept for 1h (Anthropic only). */
	cacheWrite1h?: number;
}

/** The registry Fisi Dock reads: Pi's ModelRegistry.find(provider, modelId). */
export interface ModelFinder {
	find(provider: string, modelId: string): { cost?: unknown } | undefined;
}

/** pi-claude-bridge serves Anthropic's catalog under the same model ids. */
const NATIVE_PROVIDER = "anthropic";

const record = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const amount = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);

/** Same math as Pi's calculateCost (pi-ai models.js): highest passed tier, 1h cache writes at twice the input rate. */
export function messageCost(usage: UsageLike, rates: PriceRates): number {
	const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	let tier: Omit<PriceRates, "tiers"> = rates;
	let threshold = -1;
	for (const next of rates.tiers ?? []) {
		if (inputTokens > next.inputTokensAbove && next.inputTokensAbove > threshold) {
			tier = next;
			threshold = next.inputTokensAbove;
		}
	}
	const longWrite = usage.cacheWrite1h ?? 0;
	const total = (tier.input * usage.input + tier.output * usage.output + tier.cacheRead * usage.cacheRead + tier.cacheWrite * (usage.cacheWrite - longWrite) + tier.input * 2 * longWrite) / 1_000_000;
	return Math.round(total * 1e9) / 1e9;
}

function rates(value: unknown): PriceRates | undefined {
	const cost = record(value);
	const [input, output, cacheRead, cacheWrite] = ["input", "output", "cacheRead", "cacheWrite"].map((key) => amount(cost?.[key]));
	if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) return undefined;
	const tiers = Array.isArray(cost?.tiers) ? cost.tiers.flatMap((tier) => {
		const base = rates(tier);
		const above = amount(record(tier)?.inputTokensAbove);
		return base && above !== undefined ? [{ input: base.input, output: base.output, cacheRead: base.cacheRead, cacheWrite: base.cacheWrite, inputTokensAbove: above }] : [];
	}) : [];
	return { input, output, cacheRead, cacheWrite, ...(tiers.length ? { tiers } : {}) };
}

const priced = (value: PriceRates | undefined) => value !== undefined && value.input + value.output + value.cacheRead + value.cacheWrite > 0;

/** Normalizes a model identifier by stripping proxy/channel/vendor prefixes. */
export function cleanModelKey(model: string): string {
	return model
		.replace(/^(vc\d+\/|antigravity\/|google\/|anthropic\/|openai\/|oh-my-cpa\/)/i, "")
		.trim();
}

/** Default price catalog for known models (matching Shell-PAMC & standard API list prices). */
export const DEFAULT_MODEL_PRICES: Record<string, PriceRates> = {
	"gemini-3.8-flash-high": { input: 0.825, output: 4.125, cacheRead: 0.0825, cacheWrite: 0.0416666666666667 },
	"gemini-3-flash": { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.0833333333333333 },
	"gemini-3.1-flash-image": { input: 0.5, output: 3, cacheRead: 0.5, cacheWrite: 0.5 },
	"gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0.0833333333333333 },
	"gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.0833333333333333 },
	"gemini-3.5-flash": { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0.0833333333333333 },
	"gemini-3.6-flash": { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.0416666666666667 },
	"gemini-3.7-flash": { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.0416666666666667 },
	"gemini-4-argon": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0.1875 },
	"claude-opus-4-6-thinking": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
	"claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	"gpt-oss-120b-medium": { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
	"gpt-6.1-sol": { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
	"gpt-6-astra": { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
	"gpt-6-luna": { input: 2, output: 8, cacheRead: 1, cacheWrite: 2 },
	"gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
	"gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
};

/** Prices from dynamic source, Pi's registry, or fallback catalog. */
export function registryPrices(
	registry: ModelFinder | undefined,
	dynamicPrices?: Record<string, PriceRates>,
	fallbackCatalog?: Record<string, PriceRates>,
): PriceLookup {
	const findInRegistry = (provider: string, model: string) => {
		try {
			return rates(registry?.find(provider, model)?.cost);
		} catch {
			return undefined;
		}
	};
	return (provider, model) => {
		const clean = cleanModelKey(model);
		// 1. Dynamic prices (from Shell-PAMC live sync)
		if (dynamicPrices) {
			const dyn = dynamicPrices[model] ?? dynamicPrices[clean];
			if (priced(dyn)) return dyn;
		}
		// 2. Pi's ModelRegistry
		const own = provider ? findInRegistry(provider, model) : undefined;
		if (priced(own)) return own;
		const native = provider === NATIVE_PROVIDER ? undefined : findInRegistry(NATIVE_PROVIDER, model);
		if (priced(native)) return native;
		const cleanNative = clean !== model ? findInRegistry(NATIVE_PROVIDER, clean) : undefined;
		if (priced(cleanNative)) return cleanNative;
		// 3. Fallback catalog (Shell-PAMC / standard catalog)
		if (fallbackCatalog) {
			const fallback = fallbackCatalog[model] ?? fallbackCatalog[clean];
			if (priced(fallback)) return fallback;
		}
		return undefined;
	};
}

/**
 * The session's assistant messages priced at their model's API rates, the
 * entries sessionCost walks. Undefined when there are no tokens or any
 * message with tokens has no price: a partial sum would look like the total.
 */
export function estimateSessionCost(entries: readonly unknown[], lookup: PriceLookup): number | undefined {
	const known = new Map<string, PriceRates | undefined>();
	let total = 0;
	let any = false;
	for (const entry of Array.isArray(entries) ? entries : []) {
		const message = record(record(entry)?.message);
		if (record(entry)?.type !== "message" || message?.role !== "assistant") continue;
		const usage = record(message.usage);
		const [input, output, cacheRead, cacheWrite] = ["input", "output", "cacheRead", "cacheWrite"].map((key) => amount(usage?.[key]) ?? 0);
		if (input + output + cacheRead + cacheWrite === 0) continue;
		const provider = typeof message.provider === "string" ? message.provider : undefined;
		const model = typeof message.model === "string" ? message.model : "";
		const key = `${provider ?? ""}\0${model}`;
		if (!known.has(key)) {
			let found: PriceRates | undefined;
			try {
				found = model ? lookup(provider, model) : undefined;
			} catch {
				found = undefined;
			}
			known.set(key, priced(found) ? found : undefined);
		}
		const price = known.get(key);
		if (!price) return undefined;
		total += messageCost({ input, output, cacheRead, cacheWrite, cacheWrite1h: amount(usage?.cacheWrite1h) }, price);
		any = true;
	}
	return any ? Math.round(total * 1e9) / 1e9 : undefined;
}
