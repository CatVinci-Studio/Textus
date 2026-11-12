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

/** A proposal's two sides to compare: what it targets and what it leaves.
 *  `append` has nothing to compare against; replace_selection targets the
 *  selection, not a quoted anchor; an insertion keeps its anchor. */
export function proposalSides(
  proposal: { action: string; anchor?: string | null; text?: string | null },
  selectedText?: string | null,
): { before: string; after: string } {
  const before =
    proposal.action === "append"
      ? ""
      : proposal.action === "replace_selection"
        ? (selectedText ?? "")
        : (proposal.anchor ?? "");
  const text = proposal.text ?? "";
  const after =
    proposal.action === "delete"
      ? ""
      : proposal.action === "insert_before"
        ? `${text}\n${before}`
        : proposal.action === "insert_after"
          ? `${before}\n${text}`
          : text;
  return { before, after };
}

/** How many lines a diff adds and takes away. */
export function lineCounts(lines: readonly { kind: string }[]): {
  added: number;
  removed: number;
} {
  return {
    added: lines.filter((line) => line.kind === "add").length,
    removed: lines.filter((line) => line.kind === "remove").length,
  };
}
