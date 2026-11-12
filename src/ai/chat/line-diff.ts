import { lcsSteps, wholeChange } from "../../utils/lcs";
type DiffKind = "context" | "add" | "remove";

interface DiffLine {
  kind: DiffKind;
  text: string;
}

/**
 * Line-level diff of two markdown snippets, for the proposal card. Plain
 * LCS: proposals are a handful of lines.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.length === 0 ? [] : before.split("\n");
  const b = after.length === 0 ? [] : after.split("\n");

  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return b.map((text) => ({ kind: "add" as const, text }));
  if (b.length === 0)
    return a.map((text) => ({ kind: "remove" as const, text }));
  // Too large to diff: shown as remove-all, add-all.
  const steps =
    lcsSteps(a.length, b.length, (i, j) => a[i] === b[j], "delete") ??
    wholeChange(a.length, b.length);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  for (const step of steps) {
    if (step === "same") {
      out.push({ kind: "context", text: a[i++] });
      j++;
    } else if (step === "delete") out.push({ kind: "remove", text: a[i++] });
    else out.push({ kind: "add", text: b[j++] });
  }
  return out;
}
