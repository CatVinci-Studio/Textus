import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { EditorState } from "@milkdown/kit/prose/state";
import { escapeHtml } from "../../utils/html";
import { stateWithLiveSelection } from "../live-selection";
import { isImeKeyEvent } from "../keys/ime";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  GITHUB_ALERTS,
  calloutHeading,
  readCalloutLine,
  type AlertType,
  type CalloutKind,
  type CalloutLine,
} from "./callout-syntax";
import {
  applyReveal,
  revealAll,
  type Reveal,
  type RevealState,
  type Touches,
} from "../reveal-state";

const githubAlertKey = new PluginKey("github-alert");

export type { AlertType };

/** The badge's words: the UI's language, not always English. */
export type AlertLabel = (type: AlertType) => string;

// Octicon paths (16x16 viewBox), one per kind.
const ICONS: Record<CalloutKind, string> = {
  note: "M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z",
  tip: "M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z",
  important:
    "M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  warning:
    "M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  caution:
    "M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25a.749.749 0 0 1-.53.22H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z",
  // Octicon "quote".
  quote:
    "M1.75 2.5h10.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Zm4 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5ZM2.5 7.75v6a.75.75 0 0 1-1.5 0v-6a.75.75 0 0 1 1.5 0Z",
};

const CHEVRON =
  "M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.94l3.72-3.72a.749.749 0 0 1 1.06 0Z";

function buildTitle(
  callout: CalloutLine,
  heading: string,
  folded: boolean,
  view: EditorView,
  getPos: () => number | undefined,
) {
  const el = document.createElement("span");
  el.className = "md-alert-title";
  el.contentEditable = "false";
  el.innerHTML =
    `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${ICONS[callout.kind]}"/></svg>` +
    `<span>${escapeHtml(heading)}</span>`;
  if (callout.fold) {
    const fold = document.createElement("span");
    fold.className = "md-alert-fold";
    fold.dataset.folded = String(folded);
    fold.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${CHEVRON}"/></svg>`;
    // Folding is the view's alone: the file keeps its "-" or "+".
    fold.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const widgetPos = getPos();
      if (typeof widgetPos !== "number") return;
      view.dispatch(
        view.state.tr
          .setMeta(githubAlertKey, { toggle: widgetPos - 2 })
          .setMeta("addToHistory", false),
      );
    });
    el.append(fold);
  }
  // Clicking the badge puts the cursor on the hidden marker, revealing it.
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

/** A paragraph's first line: its text, where it ends and the size of the
 *  break after it (0 at the paragraph's end). */
function firstLine(para: ProseNode): {
  text: string;
  end: number;
  breakSize: number;
} {
  let text = "";
  let offset = 0;
  for (let i = 0; i < para.childCount; i++) {
    const child = para.child(i);
    if (child.type.name === "hardbreak")
      return { text, end: offset, breakSize: child.nodeSize };
    const own = child.isText ? child.text! : child.textContent;
    const nl = child.isText ? own.indexOf("\n") : -1;
    if (nl >= 0)
      return { text: text + own.slice(0, nl), end: offset + nl, breakSize: 1 };
    text += own;
    offset += child.nodeSize;
  }
  return { text, end: offset, breakSize: 0 };
}

export interface AlertMarker {
  callout: CalloutLine;
  /** The marker's length, `[!faq]-`. */
  length: number;
  /** The first line's length: marker and title. */
  line: number;
  /** How much of the first paragraph hides behind the badge: the line and
   *  the break after it. */
  hidden: number;
}

/** A blockquote's callout marker, or null when the quote isn't a callout. */
export function alertMarker(quote: ProseNode): AlertMarker | null {
  // The marker must open the quote's very first line.
  const para = quote.firstChild;
  if (!para || !para.isTextblock) return null;
  const firstText = para.firstChild;
  if (!firstText || !firstText.isText || !firstText.text?.startsWith("[!"))
    return null;
  const line = firstLine(para);
  const callout = readCalloutLine(line.text);
  if (!callout) return null;
  return {
    callout,
    length: callout.length,
    line: line.end,
    hidden: line.end + line.breakSize,
  };
}

/**
 * Backspace at the start of an alert's first line would join it to the
 * hidden marker. The first press does nothing; a second takes the marker
 * out. Returns the range to delete, or false when the caret isn't there.
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
    // The body on the marker's own paragraph, or anywhere in the hidden marker,
    // where Home puts the caret.
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

/** What one blockquote draws when it is a callout. `toggled`: the quotes
 *  whose fold the user flipped from what the file says. */
function decorateAlert(
  node: ProseNode,
  pos: number,
  touches: Touches,
  labelOf: AlertLabel,
  toggled: readonly number[],
  decorations: Decoration[],
) {
  const marker = alertMarker(node);
  if (!marker) return;
  const { callout, line, hidden } = marker;
  const markerFrom = pos + 2; // +1 into the blockquote, +1 into its first paragraph
  const end = pos + node.nodeSize - 1;
  const folded =
    callout.fold !== "" &&
    (callout.fold === "-") !== toggled.includes(pos) &&
    // The caret in the body opens it, or it would type out of sight.
    !touches(markerFrom + hidden, end);

  decorations.push(
    Decoration.node(pos, pos + node.nodeSize, {
      class: `md-alert md-alert-${callout.kind} callout${folded ? " md-alert-folded" : ""}`,
      "data-callout": callout.name.toLowerCase(),
    }),
  );
  if (folded) {
    const paraEnd = pos + 1 + node.firstChild!.nodeSize - 1;
    if (markerFrom + hidden < paraEnd)
      decorations.push(
        Decoration.inline(markerFrom + hidden, paraEnd, {
          class: "md-alert-marker-hidden",
        }),
      );
  }

  // Only the raw first line toggles between hidden and shown; the
  // callout's styling stays while editing.
  if (touches(markerFrom, markerFrom + line)) return;
  const heading = calloutHeading(callout, labelOf);
  decorations.push(
    Decoration.inline(markerFrom, markerFrom + hidden, {
      class: "md-alert-marker-hidden",
    }),
  );
  decorations.push(
    Decoration.widget(
      markerFrom,
      (view, getPos) => buildTitle(callout, heading, folded, view, getPos),
      { side: -1 },
    ),
  );
}

const isBlockquote = (node: ProseNode) => node.type.name === "blockquote";

/** Callouts drawn per outermost blockquote, the ones quoted inside it too. */
function alertReveal(
  labelOf: AlertLabel,
  toggled: () => readonly number[],
): Reveal {
  return {
    match: isBlockquote,
    decorate(node, pos, touches) {
      const decorations: Decoration[] = [];
      const flipped = toggled();
      decorateAlert(node, pos, touches, labelOf, flipped, decorations);
      node.descendants((child, offset) => {
        if (isBlockquote(child))
          decorateAlert(
            child,
            pos + 1 + offset,
            touches,
            labelOf,
            flipped,
            decorations,
          );
      });
      return decorations;
    },
    // A fold flipped draws everything again: rare, and a click.
    config: () =>
      GITHUB_ALERTS.map(labelOf).join("\n") + "|" + toggled().join(","),
  };
}

/** The quotes whose fold was flipped, kept at their places through `tr`. */
function mapToggled(tr: Transaction, toggled: number[]): number[] {
  let next = toggled;
  if (tr.docChanged)
    next = toggled.flatMap((p) => {
      const mapped = tr.mapping.mapResult(p, 1);
      return mapped.deleted ? [] : [mapped.pos];
    });
  const flip = (tr.getMeta(githubAlertKey) as { toggle?: number } | undefined)
    ?.toggle;
  if (flip === undefined) return next;
  return next.includes(flip) ? next.filter((p) => p !== flip) : [...next, flip];
}

/** The document a first Backspace at an alert's first line was pressed on. */
const firstPress = new WeakMap<EditorView, ProseNode>();

interface AlertState extends RevealState {
  toggled: number[];
}

/** GitHub alerts and Obsidian callouts: a blockquote whose first line is
 *  `[!NOTE]`, `[!faq]- Title` etc. renders as a callout, the line real text
 *  behind a badge. */
export function createGithubAlertPlugin(labelOf: AlertLabel) {
  return $prose(() => {
    // What decorate reads: set by apply before it draws.
    let toggled: number[] = [];
    const reveal = alertReveal(labelOf, () => toggled);
    return new Plugin<AlertState>({
      key: githubAlertKey,
      state: {
        init: (_config, state) => {
          toggled = [];
          return { ...revealAll(state, reveal), toggled };
        },
        apply: (tr, prev, oldState, newState) => {
          toggled = mapToggled(tr, prev.toggled);
          return {
            ...applyReveal(tr, prev, oldState, newState, reveal),
            toggled,
          };
        },
      },
      props: {
        decorations(state) {
          return githubAlertKey.getState(state)?.set;
        },
        handleKeyDown(view, event) {
          if (event.key !== "Backspace" || isImeKeyEvent(view, event))
            return false;
          if (event.metaKey || event.ctrlKey || event.altKey) return false;
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
    });
  });
}
