import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Strings } from "../i18n/strings";
import type { ContextMenuItem } from "../engine/controls/ContextMenu";
import { LINK } from "./markdown/link-source";
import { linkHrefAt } from "./markdown/link-reveal";
import { parseLink } from "./markdown/link-syntax";
import { labelText } from "./markdown/link-label";
import { openLinkHref, openWikilink } from "./markdown/link-click-plugin";
import type { EditorRunner } from "./useEditorRunner";

/** The link right-clicked: where its node starts, its source and its URL. */
export interface MenuLink {
  pos: number;
  source: string;
  href: string;
  /** The document it is in, for a relative link. */
  docPath: string | null;
  /** A `[[note]]` link: opened and copied, its source edited in place. */
  wiki?: boolean;
}

/** The Markdown link under `target`, if any. */
function menuLinkAt(
  view: EditorView,
  target: EventTarget | null,
  docPath: string | null,
): MenuLink | null {
  const wiki = (target as Element | null)?.closest?.('[data-type="wikilink"]');
  if (wiki && view.dom.contains(wiki)) {
    const source = wiki.textContent ?? "";
    const pos = view.posAtDOM(wiki, 0) - 1;
    return { pos, source, href: source, docPath, wiki: true };
  }
  const href = linkHrefAt(view, target);
  const el = (target as Element | null)?.closest?.(`[data-type="${LINK}"]`);
  if (href === null || !el) return null;
  const pos = view.posAtDOM(el, 0) - 1;
  const node = view.state.doc.nodeAt(pos);
  return node?.type.name === LINK
    ? { pos, source: node.textContent, href, docPath }
    : null;
}

/** The link a menu is for: under the pointer, or, opened from a button
 *  (the phone's ⋯), the one the caret is in. */
export function linkForMenu(
  view: EditorView,
  target: EventTarget | null,
  docPath: string | null,
  fromButton: boolean,
): MenuLink | null {
  return (
    menuLinkAt(view, target, docPath) ??
    (fromButton ? menuLinkAt(view, caretElement(view), docPath) : null)
  );
}

/** The link the caret is in, for the phone's ⋯ sheet. */
export function caretLink(
  run: EditorRunner,
  docPath: string | null,
): MenuLink | null {
  return (
    run((ctx) => linkForMenu(ctx.get(editorViewCtx), null, docPath, true)) ??
    null
  );
}

/** The element the caret is in, to look for a link around. */
function caretElement(view: EditorView): Element | null {
  try {
    const { node } = view.domAtPos(view.state.selection.from);
    return node instanceof Element ? node : node.parentElement;
  } catch {
    return null;
  }
}

/** Open, Copy, Edit and Remove for the link right-clicked. */
export function linkMenuItems(
  run: EditorRunner,
  t: Strings,
  link: MenuLink,
): ContextMenuItem[] {
  const parts = parseLink(link.source);
  const withView = (act: (view: EditorView) => void) => () =>
    run((ctx) => act(ctx.get(editorViewCtx)));
  if (link.wiki)
    return [
      {
        label: t.menuOpenLink,
        onSelect: withView((view) =>
          openWikilink(view, link.source, link.docPath),
        ),
      },
      {
        label: t.menuCopyLink,
        onSelect: () =>
          void navigator.clipboard.writeText(link.source).catch(() => {}),
      },
    ];
  return [
    {
      label: t.menuOpenLink,
      onSelect: withView((view) => openLinkHref(view, link.href, link.docPath)),
    },
    {
      label: t.menuCopyLink,
      onSelect: () =>
        void navigator.clipboard.writeText(link.href).catch(() => {}),
    },
    // Its source shown with the destination selected, to type over.
    {
      label: t.menuEditLink,
      onSelect: withView((view) => {
        const at = parts ? link.source.indexOf(parts.dest, parts.label[1]) : -1;
        const from = link.pos + 1 + Math.max(0, at);
        const to = at < 0 ? from : from + parts!.dest.length;
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, from, to),
          ),
        );
        view.focus();
      }),
    },
    // Its words kept as plain text.
    {
      label: t.menuRemoveLink,
      onSelect: withView((view) => {
        const node = view.state.doc.nodeAt(link.pos);
        if (node?.type.name !== LINK) return;
        const words = parts
          ? labelText(link.source.slice(...parts.label)) || parts.dest
          : link.source;
        view.dispatch(
          view.state.tr.replaceWith(
            link.pos,
            link.pos + node.nodeSize,
            view.state.schema.text(words),
          ),
        );
        view.focus();
      }),
    },
  ];
}
