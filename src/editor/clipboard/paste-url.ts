import { Plugin } from "@milkdown/kit/prose/state";
import type { Slice } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { LINK } from "../markdown/link-source";
import { linkSource, parseLink } from "../markdown/link-syntax";

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

/** What a selection reads as: a link as its label. */
function labelText(slice: Slice): string {
  let text = "";
  slice.content.descendants((node) => {
    if (node.type.name === LINK) {
      const source = node.textContent;
      const parts = parseLink(source);
      text += parts ? source.slice(...parts.label) : source;
      return false;
    }
    if (node.isText) text += node.text;
    return true;
  });
  return text;
}

/** Pastes `url` as a link: over selected text, that text links to it; else
 *  a new link. Inside a link's source, or after a typed `](`, it is text.
 *  False where no link may go. */
export function insertUrlLink(view: EditorView, url: string): boolean {
  const { state } = view;
  const link = state.schema.nodes[LINK];
  const { $from, $to, empty, from, to } = state.selection;
  if (
    !link ||
    $from.parent.type.spec.code ||
    !$from.parent.type.contentMatch.matchType(link)
  )
    return false;
  // The address of a link being typed: `)` makes the link of it all.
  if (empty && $from.parent.textBetween(0, $from.parentOffset).endsWith("](")) {
    view.dispatch(state.tr.insertText(url).setMeta("uiEvent", "paste"));
    return true;
  }
  const label =
    !empty && $from.sameParent($to) ? labelText(state.doc.slice(from, to)) : "";
  const node = link.create(
    null,
    state.schema.text(linkSource(label.trim() ? label : url, url)),
  );
  const tr = state.tr.replaceSelectionWith(node, false);
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
