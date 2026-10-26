import type { EditProposal } from "../types";
import { joinedText } from "./generated-images";
import { isPicture } from "./markdown-forms";

/** An edit anchored in undecided proposed text, made in that text. Null for
 *  appends, cursor or selection edits, or an anchor not found exactly once. */
export function editedText(text: string, edit: EditProposal): string | null {
  const anchor = edit.anchor ?? "";
  const at = anchor ? text.indexOf(anchor) : -1;
  if (at < 0 || text.indexOf(anchor, at + 1) >= 0) return null;
  const add = edit.text ?? "";
  const before = text.slice(0, at);
  const after = text.slice(at + anchor.length);
  switch (edit.action) {
    case "replace":
      return before + add + after;
    case "delete":
      return tidy(before + after);
    case "insert_after":
      // A paragraph of its own after the anchor's paragraph, as a picture
      // joins (joinedText); words go on from the anchor.
      if (add.includes("\n\n") || after === "" || after.startsWith("\n\n"))
        return joinedText(text, anchor, "insert_after", add);
      return before + anchor + gap(anchor, add) + add + after;
    case "insert_before":
      if (add.includes("\n\n") || before === "" || before.endsWith("\n\n"))
        return joinedText(text, anchor, "insert_before", add);
      return before + add + gap(add, anchor) + anchor + after;
    default:
      return null;
  }
}

const CJK =
  /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;

/** The space between `left` and `right` run together: one between two
 *  words of a language that spaces them; none after CJK, before
 *  punctuation, or where either side has one already. */
function gap(left: string, right: string): string {
  const last = left.slice(-1);
  const first = right.charAt(0);
  if (!last || !first || /\s/.test(last) || /\s/.test(first)) return "";
  if (CJK.test(last) || CJK.test(first) || /[.,;:!?)\]}]/.test(first))
    return "";
  return " ";
}

/** No empty paragraphs left where a deleted passage was. */
function tidy(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
}

/** A pending picture whose paragraph an accepted rewrite replaced, moved to
 *  the new text's nth paragraph (or its last). Null when there's none. */
export function reanchoredPicture(
  picture: EditProposal,
  oldText: string,
  newText: string,
  blocks: readonly { id: string; markdown: string }[],
): EditProposal | null {
  const anchor = picture.anchor;
  if (
    !anchor ||
    (picture.action !== "insert_after" && picture.action !== "insert_before")
  )
    return null;
  const at = oldText.split(/\n{2,}/).findIndex((p) => p.includes(anchor));
  if (at < 0) return null;
  const paragraphs = newText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !isPicture(p));
  if (paragraphs.length === 0) return null;
  const paragraph = paragraphs[Math.min(at, paragraphs.length - 1)];
  const block =
    blocks.find((b) => b.markdown.trim() === paragraph) ??
    blocks.find((b) => b.markdown.includes(paragraph));
  if (!block) return null;
  return {
    ...picture,
    block: block.id,
    lastBlock: undefined,
    anchor: block.markdown,
  };
}
