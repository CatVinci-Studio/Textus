/**
 * How much the window keeps loaded out of sight, from how much memory the
 * machine has and how short of it the system is now (memory_level.rs).
 * One owner: the kept views (kept-loaded.ts) read their limits here, and a
 * tighter level lets go at once what no longer fits.
 */
type MemoryLevel = "roomy" | "normal" | "tight" | "critical";

interface MemoryLimits {
  /** Views of one kind kept loaded, the one on screen among them. */
  keep: number;
  /** How long one out of sight stays loaded. */
  hiddenMs: number;
}

const MINUTE = 60_000;
const LIMITS: Record<MemoryLevel, MemoryLimits> = {
  roomy: { keep: 5, hiddenMs: 10 * MINUTE },
  normal: { keep: 3, hiddenMs: 5 * MINUTE },
  tight: { keep: 2, hiddenMs: 2 * MINUTE },
  critical: { keep: 1, hiddenMs: MINUTE / 2 },
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
const listeners = new Set<(level: MemoryLevel, tighter: boolean) => void>();

export function memoryLimits(): MemoryLimits {
  return LIMITS[level];
}

/** Told when the level moves, and whether it is tighter than it was. */
export function onMemoryLevel(
  listener: (level: MemoryLevel, tighter: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setMemoryState(state: {
  totalMb: number;
  pressure: number;
}): void {
  const next = levelOf(state.totalMb, state.pressure);
  if (next === level) return;
  const tighter = ORDER.indexOf(next) > ORDER.indexOf(level);
  level = next;
  for (const listener of listeners) listener(next, tighter);
}
