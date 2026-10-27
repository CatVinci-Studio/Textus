import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { EditorState } from "@milkdown/kit/prose/state";
import { escapeHtml } from "../../utils/html";
import { isImeKeyEvent, stateWithLiveSelection } from "../marks/enclosure";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  applyReveal,
  revealAll,
  type Reveal,
  type RevealState,
  type Touches,
} from "../reveal-state";

const githubAlertKey = new PluginKey("github-alert");

// GitHub's five alert types, with their octicon paths (16x16 viewBox).
export type AlertType = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

/** The badge's words: the UI's language, not always English. */
export type AlertLabel = (type: AlertType) => string;
const ALERT_TYPES: Record<AlertType, { icon: string }> = {
  NOTE: {
    icon: "M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z",
  },
  TIP: {
    icon: "M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z",
  },
  IMPORTANT: {
    icon: "M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  },
  WARNING: {
    icon: "M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  },
  CAUTION: {
    icon: "M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25a.749.749 0 0 1-.53.22H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z",
  },
};

const ALERT_NAMES = Object.keys(ALERT_TYPES) as AlertType[];

// Any case, as GitHub and Obsidian read it, and with Obsidian's "-" / "+"
// (folded / unfolded) after it.
const MARKER_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][-+]?/i;

function buildTitle(
  info: { icon: string },
  label: string,
  view: EditorView,
  getPos: () => number | undefined,
) {
  const el = document.createElement("span");
  el.className = "md-alert-title";
  el.contentEditable = "false";
  el.innerHTML =
    `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${info.icon}"/></svg>` +
    `<span>${escapeHtml(label)}</span>`;
  // Clicking the badge puts the cursor on the (currently hidden) marker,
  // which reveals it for editing - same interaction as the math preview.
  el.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const widgetPos = getPos();
    if (typeof widgetPos !== "number") return;
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, widgetPos),
      ),
    );
    view.focus();
  });
  return el;
}

/** A blockquote's alert marker: its type, the marker's length, and how
 *  much of the first paragraph is hidden behind the badge - the marker,
 *  the spaces after it and the line break ending its line. Null when the
 *  quote isn't an alert. */
export function alertMarker(
  quote: ProseNode,
): { type: AlertType; length: number; hidden: number } | null {
  // GitHub's syntax: the marker must be the blockquote's very first line,
  // alone. In ProseMirror terms: the first child is a textblock whose
  // first text node starts with the marker, with nothing but whitespace
  // (or a line break) after it in that text node.
  const para = quote.firstChild;
  if (!para || !para.isTextblock) return null;
  const firstText = para.firstChild;
  if (!firstText || !firstText.isText || !firstText.text) return null;
  const match = MARKER_RE.exec(firstText.text);
  if (!match) return null;
  const rest = firstText.text.slice(match[0].length);
  if (!/^[ \t]*(\n|$)/.test(rest)) return null;
  const hideLen = match[0].length + (/^[ \t]*\n?/.exec(rest)?.[0].length ?? 0);
  // The marker line's soft break, when it is a node of its own (an
  // inline hardbreak, drawn as a space): hidden with the marker, it
  // started the body one space in from the lines under it.
  const next = para.childCount > 1 ? para.child(1) : null;
  const breakAfter =
    hideLen === firstText.text.length && next?.type.name === "hardbreak"
      ? next.nodeSize
      : 0;
  return {
    type: match[1].toUpperCase() as AlertType,
    length: match[0].length,
    hidden: hideLen + breakAfter,
  };
}

/**
 * Backspace at the start of an alert's first line of text. Joined to the
 * line before like any other, that line is the hidden marker: the badge
 * went and "[!NOTE]body" showed in a plain quote. The first press leaves
 * the alert as it is; a second one, right after, takes the marker out and
 * leaves a plain quote. Returns the range to delete on that second press,
 * or false when the caret isn't there.
 */
function markerBeforeCaret(
  state: EditorState,
): { from: number; to: number } | false {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  for (let d = $from.depth - 1; d > 0; d--) {
    const quote = $from.node(d);
    if (!isBlockquote(quote)) continue;
    const marker = alertMarker(quote);
    if (!marker) return false;
    const quotePos = $from.before(d);
    const first = quote.firstChild!;
    const markerFrom = quotePos + 2;
    // The body on the marker's own paragraph, after its line break - or
    // anywhere in the hidden marker, where Home puts the caret when the
    // body shares the marker's text (Chromium before it, WebKit before
    // the line end).
    const markerTo = markerFrom + marker.hidden;
    if (
      $from.depth === d + 1 &&
      $from.index(d) === 0 &&
      $from.pos >= markerFrom &&
      $from.pos <= markerTo
    )
      return { from: markerFrom, to: markerTo };
    // The body in a paragraph of its own under a marker alone on its line.
    const secondStart = quotePos + 1 + first.nodeSize + 1;
    if (
      marker.hidden === first.content.size &&
      $from.index(d) === 1 &&
      $from.pos === secondStart
    )
      return { from: quotePos + 1, to: quotePos + 1 + first.nodeSize };
    return false;
  }
  return false;
}

/** What one blockquote draws when it is an alert. */
function decorateAlert(
  node: ProseNode,
  pos: number,
  touches: Touches,
  labelOf: AlertLabel,
  decorations: Decoration[],
) {
  // GitHub's syntax: the marker must be the blockquote's very first line,
  // alone. In ProseMirror terms: the first child is a textblock whose
  // first text node starts with the marker, with nothing but whitespace
  // (or a line break) after it in that text node.
  const marker = alertMarker(node);
  if (!marker) return;
  const { type, length, hidden } = marker;
  const info = ALERT_TYPES[type];
  const label = labelOf(type);

  decorations.push(
    Decoration.node(pos, pos + node.nodeSize, {
      class: `md-alert md-alert-${type.toLowerCase()}`,
    }),
  );

  // The colored border/title stay on even while editing; only the raw
  // [!TYPE] marker toggles between hidden (badge shown in its place) and
  // visible (cursor touching it).
  const markerFrom = pos + 2; // +1 into the blockquote, +1 into its first paragraph
  const markerTo = markerFrom + hidden;
  if (touches(markerFrom, markerFrom + length)) return;

  decorations.push(
    Decoration.inline(markerFrom, markerTo, {
      class: "md-alert-marker-hidden",
    }),
  );
  decorations.push(
    Decoration.widget(
      markerFrom,
      (view, getPos) => buildTitle(info, label, view, getPos),
      { side: -1 },
    ),
  );
}

const isBlockquote = (node: ProseNode) => node.type.name === "blockquote";

/** Alerts drawn per outermost blockquote, the ones quoted inside it too. */
function alertReveal(labelOf: AlertLabel): Reveal {
  return {
    match: isBlockquote,
    decorate(node, pos, touches) {
      const decorations: Decoration[] = [];
      decorateAlert(node, pos, touches, labelOf, decorations);
      node.descendants((child, offset) => {
        if (isBlockquote(child))
          decorateAlert(child, pos + 1 + offset, touches, labelOf, decorations);
      });
      return decorations;
    },
    // The badges' words: the UI's language.
    config: () => ALERT_NAMES.map(labelOf).join("\n"),
  };
}

/**
 * GitHub-style alerts: a blockquote whose first line is `[!NOTE]`,
 * `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` renders as the
 * matching colored callout with an icon badge in place of the marker. The
 * marker is real text (round-trips through markdown untouched); clicking
 * the badge, or moving the cursor onto it, reveals it for editing.
 */
/** The document a Backspace at an alert's first line was pressed on and
 *  left alone (markerBeforeCaret): the next press on it removes the
 *  marker. */
const firstPress = new WeakMap<EditorView, ProseNode>();

export function createGithubAlertPlugin(labelOf: AlertLabel) {
  const reveal = alertReveal(labelOf);
  return $prose(
    () =>
      new Plugin<RevealState>({
        key: githubAlertKey,
        state: {
          init: (_config, state) => revealAll(state, reveal),
          apply: (tr, prev, oldState, newState) =>
            applyReveal(tr, prev, oldState, newState, reveal),
        },
        props: {
          decorations(state) {
            return githubAlertKey.getState(state)?.set;
          },
          handleKeyDown(view, event) {
            if (event.key !== "Backspace" || isImeKeyEvent(view, event))
              return false;
            if (event.metaKey || event.ctrlKey || event.altKey) return false;
            // The caret a click or Home has just put there.
            const state = stateWithLiveSelection(view);
            const marker = markerBeforeCaret(state);
            if (!marker) {
              firstPress.delete(view);
              return false;
            }
            event.preventDefault();
            if (firstPress.get(view) !== state.doc) {
              firstPress.set(view, state.doc);
              return true;
            }
            firstPress.delete(view);
            view.dispatch(state.tr.delete(marker.from, marker.to));
            return true;
          },
        },
      }),
  );
}
