import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/**
 * A pasted URL becomes a link whose text is the URL, written `[url](url)`.
 *
 * Left to the markdown parser, a bare URL is a GFM autolink literal, which
 * remark writes back as `<https://...>` - a form readers took for a bug
 * (issue #60), and one that only reads as a link in the source to someone
 * who knows the autolink syntax. `[url](url)` is the plain link syntax,
 * clickable in the editor and in every Markdown renderer (a bare URL is
 * not: CommonMark without GFM leaves it text), and it is written back the
 * same way because the link mark remembers its syntax (markdown-output.ts).
 * The text is the URL rather than empty, as some apps write it: `[](url)`
 * shows nothing at all on GitHub and most other renderers.
 */

/** The URL, when the pasted text is one URL and nothing else. */
export function bareUrl(text: string): string | null {
  const trimmed = text.trim();
  return /^(?:(?:https?|ftp):\/\/|mailto:)[^\s<>]+$/i.test(trimmed)
    ? trimmed
    : null;
}

/** Pastes `url` as a link: over selected text, that text becomes a link to
 *  it (the way most editors take a URL pasted on a selection); with the
 *  caret inside an existing link, it goes in as that link's text - a new
 *  link there split the old one in three around it; anywhere else, a new
 *  link whose text is the URL. False when there is no link mark here
 *  (inside code, say), so the caller pastes it as text. */
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
    // The selected words keep their text and take the URL; an old link on
    // them is replaced rather than nested.
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
