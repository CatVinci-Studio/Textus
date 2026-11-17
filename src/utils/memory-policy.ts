import { createSubscribers } from "./store";
/**
 * How much the window keeps loaded out of sight, from how much memory the
 * machine has and how short of it the system is now (memory_level.rs).
 * One owner: the kept views (kept-loaded.ts) read their limits here, and a
 * tighter level lets go at once what no longer fits.
 */
type MemoryLevel = "roomy" | "normal" | "tight" | "critical";

interface MemoryLimits {
  /** Views of one kind kept loaded out of sight; those on screen are
   *  always loaded. */
  keep: number;
  /** How long one out of sight stays loaded. */
  hiddenMs: number;
}

const MINUTE = 60_000;
const LIMITS: Record<MemoryLevel, MemoryLimits> = {
  roomy: { keep: 4, hiddenMs: 10 * MINUTE },
  normal: { keep: 2, hiddenMs: 5 * MINUTE },
  tight: { keep: 1, hiddenMs: 2 * MINUTE },
  critical: { keep: 0, hiddenMs: MINUTE / 2 },
};
const ORDER: MemoryLevel[] = ["roomy", "normal", "tight", "critical"];

/** The level for a machine of `totalMb` with the system at `pressure`
 *  (0 none, 1 short, 2 very short). */
function levelOf(totalMb: number, pressure: number): MemoryLevel {
  if (pressure >= 2) return "critical";
  if (pressure === 1) return "tight";
  if (totalMb > 0 && totalMb < 8 * 1024) return "tight";
  return totalMb >= 32 * 1024 ? "roomy" : "normal";
}

let level: MemoryLevel = "normal";
const levels = createSubscribers<[level: MemoryLevel, tighter: boolean]>();

export function memoryLimits(): MemoryLimits {
  return LIMITS[level];
}

/** Told when the level moves, and whether it is tighter than it was. */
export const onMemoryLevel = levels.subscribe;

export function setMemoryState(state: {
  totalMb: number;
  pressure: number;
}): void {
  const next = levelOf(state.totalMb, state.pressure);
  if (next === level) return;
  const tighter = ORDER.indexOf(next) > ORDER.indexOf(level);
  level = next;
  levels.publish(next, tighter);
}
