/** A place that differs: the document's blocks [from, to) were the earlier
 *  text's [baseFrom, baseTo). */
export interface Hunk {
  from: number;
  to: number;
  baseFrom: number;
  baseTo: number;
}

/** Where `now` differs from `base`, block by block (longest common run). */
export function blockHunks(
  base: readonly string[],
  now: readonly string[],
): Hunk[] {
  const n = base.length;
  const m = now.length;
  // keep[i][j]: the longest common run of base[i..] and now[j..].
  const keep = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      keep[i][j] =
        base[i] === now[j]
          ? keep[i + 1][j + 1] + 1
          : Math.max(keep[i + 1][j], keep[i][j + 1]);
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: Hunk | null = null;
  const close = () => {
    if (open) hunks.push({ ...open, baseTo: i, to: j });
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === now[j]) {
      close();
      i++;
      j++;
      continue;
    }
    open ??= { from: j, to: j, baseFrom: i, baseTo: i };
    if (j < m && (i === n || keep[i][j + 1] >= keep[i + 1][j])) j++;
    else i++;
  }
  close();
  return hunks;
}
