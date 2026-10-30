import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/**
 * A pasted URL becomes `[url](url)`: remark writes a bare autolink back as
 * `<https://...>`, which readers took for a bug, and `[](url)` shows
 * nothing on most renderers.
 */

/** The URL, when the pasted text is one URL and nothing else. */
export function bareUrl(text: string): string | null {
  const trimmed = text.trim();
  return /^(?:(?:https?|ftp):\/\/|mailto:)[^\s<>]+$/i.test(trimmed)
    ? trimmed
    : null;
}

/** Pastes `url` as a link: over selected text, that text links to it; inside
 *  an existing link, as its text (a new link would split it in three); else a
 *  new link. False where no link mark is allowed. */
export function insertUrlLink(view: EditorView, url: string): boolean {
  const { state } = view;
  const link = state.schema.marks.link;
  const { $from, $to, empty, from, to } = state.selection;
  if (
    !link ||
    $from.parent.type.spec.code ||
    !$from.parent.type.allowsMarkType(link)
  )
    return false;
  const tr = state.tr;
  if (
    !empty &&
    $from.sameParent($to) &&
    state.doc.textBetween(from, to).trim()
  ) {
    // An old link on the selected words is replaced rather than nested.
    tr.removeMark(from, to, link).addMark(from, to, link.create({ href: url }));
    view.dispatch(tr.setMeta("uiEvent", "paste").scrollIntoView());
    return true;
  }
  const inLink =
    empty &&
    link.isInSet($from.marks()) &&
    $from.nodeAfter !== null &&
    link.isInSet($from.nodeAfter.marks);
  if (inLink) tr.replaceSelectionWith(state.schema.text(url), true);
  else
    tr.replaceSelectionWith(
      state.schema.text(url, [link.create({ href: url })]),
      false,
    )
      // Typing straight after the pasted URL should not extend the link.
      .setStoredMarks([]);
  view.dispatch(tr.setMeta("uiEvent", "paste").scrollIntoView());
  return true;
}

export const pasteUrlPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handlePaste(view, event) {
          const url = bareUrl(event.clipboardData?.getData("text/plain") ?? "");
          return url !== null && insertUrlLink(view, url);
        },
      },
    }),
);
