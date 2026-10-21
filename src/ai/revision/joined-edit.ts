import type { EditProposal } from "../types";
import { joinedText } from "./generated-images";

/**
 * An edit whose anchor is in text proposed and not decided yet - text the
 * user sees but the document doesn't have (src-tauri tools.rs lets it
 * through): the proposal's text with the edit made in it, or null when the
 * edit isn't one that can go into text this way (an append, the cursor's,
 * the selection's) or its anchor isn't there exactly once.
 */
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
