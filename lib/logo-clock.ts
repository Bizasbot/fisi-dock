import type { OrbMotion } from "./orbs.ts";

export const LOGO_STEP_MS = 80;

export interface LogoClockOptions {
	now(): number;
	motion?(): OrbMotion;
	requestRender(): void;
	setInterval?(tick: () => void, ms: number): unknown;
	clearInterval?(handle: unknown): void;
}

export interface LogoClock {
	/** Current animation tick; undefined if motion is potato. */
	tick(): number | undefined;
	/** Start or ensure the animation timer runs (if motion allows). */
	start(): void;
	/** Stop the animation timer. */
	stop(): void;
	dispose(): void;
}

/**
 * Wall-clock driven animation timer for the sidebar top wordmark.
 * Runs at LOGO_STEP_MS when active and motion is quality/performance;
 * turns off under potato motion or when disposed.
 */
export function createLogoClock(options: LogoClockOptions): LogoClock {
	const startTimer = options.setInterval ?? ((tick: () => void, ms: number) => {
		const handle = setInterval(tick, ms);
		(handle as { unref?(): void }).unref?.();
		return handle;
	});
	const stopTimer = options.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
	const readMotion = (): OrbMotion => {
		try {
			return options.motion?.() ?? "quality";
		} catch {
			return "quality";
		}
	};
	let timer: unknown;
	let disposed = false;
	const stop = () => {
		if (timer !== undefined) stopTimer(timer);
		timer = undefined;
	};
	const start = () => {
		if (disposed || timer !== undefined) return;
		if (readMotion() === "potato") return;
		// Keep headless unit tests focused on spinner counts without ambient timers
		if (process.env.NODE_TEST_CONTEXT && !process.env.FISI_DOCK_LOGO_TEST) return;
		timer = startTimer(() => {
			if (!disposed) options.requestRender();
		}, LOGO_STEP_MS);
	};
	return {
		tick() {
			if (readMotion() === "potato") return undefined;
			if (process.env.NODE_TEST_CONTEXT && !process.env.FISI_DOCK_LOGO_TEST) return undefined;
			return Math.floor(options.now() / LOGO_STEP_MS);
		},
		start,
		stop,
		dispose() {
			disposed = true;
			stop();
		},
	};
}
