/** One step through two sequences along their longest common subsequence:
 *  an item both keep, one only `a` has, or one only `b` has. */
export type LcsStep = "same" | "delete" | "insert";

/** The most cells a table may have (items of `a` times items of `b`): past
 *  that a diff costs more than it shows, and callers treat the whole as
 *  one change. */
export const LCS_MAX_CELLS = 250_000;

/**
 * The steps from `a` to `b` (lengths `n`, `m`, compared by `same(i, j)`)
 * along a longest common subsequence; null when the table would pass
 * LCS_MAX_CELLS. Where both ways keep as much, `prefer` says which comes
 * first: "delete" lists `a`'s side of a change before `b`'s.
 */
export function lcsSteps(
  n: number,
  m: number,
  same: (i: number, j: number) => boolean,
  prefer: "delete" | "insert",
): LcsStep[] | null {
  if (n * m > LCS_MAX_CELLS) return null;
  // keep[i][j]: the common length of a[i..] and b[j..].
  const keep = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      keep[i][j] = same(i, j)
        ? keep[i + 1][j + 1] + 1
        : Math.max(keep[i + 1][j], keep[i][j + 1]);
  const steps: LcsStep[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && same(i, j)) {
      steps.push("same");
      i++;
      j++;
    } else if (j >= m) {
      steps.push("delete");
      i++;
    } else if (i >= n) {
      steps.push("insert");
      j++;
    } else if (
      prefer === "delete"
        ? keep[i + 1][j] >= keep[i][j + 1]
        : keep[i][j + 1] < keep[i + 1][j]
    ) {
      steps.push("delete");
      i++;
    } else {
      steps.push("insert");
      j++;
    }
  }
  return steps;
}

/** The steps for a change too large to diff: all of `a`, then all of `b`. */
export function wholeChange(n: number, m: number): LcsStep[] {
  return [
    ...new Array<LcsStep>(n).fill("delete"),
    ...new Array<LcsStep>(m).fill("insert"),
  ];
}
