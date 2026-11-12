import { lcsSteps, wholeChange } from "../../utils/lcs";
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
  const steps =
    lcsSteps(base.length, now.length, (i, j) => base[i] === now[j], "insert") ??
    wholeChange(base.length, now.length);
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: Hunk | null = null;
  const close = () => {
    if (open) hunks.push({ ...open, baseTo: i, to: j });
    open = null;
  };
  for (const step of steps) {
    if (step === "same") {
      close();
      i++;
      j++;
      continue;
    }
    open ??= { from: j, to: j, baseFrom: i, baseTo: i };
    if (step === "insert") j++;
    else i++;
  }
  close();
  return hunks;
}
