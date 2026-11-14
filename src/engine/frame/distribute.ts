/**
 * How a row (or column) of islands shares its length, as VS Code's
 * workbench does: fixed ones (a panel's island: the AI, Settings) keep
 * their width in pixels, flexible ones (documents) share what is left by
 * their fractions; short of room, the lowest priority gives way first,
 * each down to its minimum, and only then the rest.
 */

export type Priority = "low" | "normal" | "high";

export interface SizeRule {
  /** The least it takes before others below its priority give way. */
  min: number;
  /** Kept even when every child must go under its minimum: the others
   *  give the shortfall first (the island under the bar's own buttons). */
  floor?: number;
  /** Pixels for a fixed one; for a flexible one, its fraction. */
  size: number;
  fixed: boolean;
  priority: Priority;
}

/** Who gives way first when there is too little room. */
const GIVE_ORDER: Priority[] = ["low", "normal", "high"];

/** Each child's length, whole pixels, summing to `length`. */
export function distribute(
  rules: readonly SizeRule[],
  length: number,
): number[] {
  if (!rules.length) return [];
  const room = Math.max(0, length);
  // With no flexible child the fixed ones fill the row by their widths.
  const flexible = rules.some((r) => !r.fixed);
  const fixedTotal = rules.reduce((sum, r) => sum + (r.fixed ? r.size : 0), 0);
  const fractionTotal =
    rules.reduce((sum, r) => sum + (r.fixed ? 0 : r.size), 0) || 1;
  const rest = Math.max(0, room - fixedTotal);
  const sizes = rules.map((r) =>
    !flexible
      ? (r.size / (fixedTotal || 1)) * room
      : r.fixed
        ? r.size
        : (r.size / fractionTotal) * rest,
  );
  // Each up to its minimum, paid for by those that give way first.
  rules.forEach((r, i) => {
    if (sizes[i] < least(r)) sizes[i] = Math.min(least(r), room);
  });
  settle(rules, sizes, room);
  return whole(sizes, room);
}

/** Takes the surplus (or shortfall) from the children in giving order,
 *  last of each group first, never below a minimum while another can give;
 *  still too long, everyone shrinks alike. */
function settle(rules: readonly SizeRule[], sizes: number[], room: number) {
  let over = sizes.reduce((a, b) => a + b, 0) - room;
  if (Math.abs(over) < 0.5) return;
  if (over < 0) {
    // Room to spare: the flexible take it, the highest priority first.
    const takers = order(rules, [...GIVE_ORDER].reverse(), (r) => !r.fixed);
    const to = takers.length ? takers : order(rules, GIVE_ORDER, () => true);
    const share = -over / to.length;
    for (const i of to) sizes[i] += share;
    return;
  }
  for (const i of order(rules, GIVE_ORDER, () => true)) {
    const give = Math.min(over, sizes[i] - least(rules[i]));
    if (give <= 0) continue;
    sizes[i] -= give;
    over -= give;
    if (over < 0.5) return;
  }
  // Still too long: everyone shrinks alike, above their floors while the
  // floors fit.
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const floors = rules.map((r, i) => Math.min(r.floor ?? 0, sizes[i]));
  const base = sum(floors) < room ? floors : sizes.map(() => 0);
  const spare = sum(sizes) - sum(base);
  const left = room - sum(base);
  for (let i = 0; i < sizes.length; i++)
    sizes[i] = base[i] + ((sizes[i] - base[i]) * left) / (spare || 1);
}

/** What a child keeps before the shrink everyone shares: its minimum, or
 *  its floor where that is more. */
const least = (r: SizeRule) => Math.max(r.min, r.floor ?? 0);

/** Indexes by priority group, last child first within a group. */
function order(
  rules: readonly SizeRule[],
  groups: Priority[],
  keep: (r: SizeRule) => boolean,
): number[] {
  return groups.flatMap((p) =>
    rules
      .map((r, i) => [r, i] as const)
      .filter(([r]) => r.priority === p && keep(r))
      .map(([, i]) => i)
      .reverse(),
  );
}

/** Rounded at the cuts, so the parts stay whole pixels and add up. */
function whole(sizes: number[], room: number): number[] {
  let at = 0;
  let cut = 0;
  return sizes.map((size, i) => {
    at += size;
    const next = i === sizes.length - 1 ? Math.round(room) : Math.round(at);
    const length = next - cut;
    cut = next;
    return length;
  });
}
