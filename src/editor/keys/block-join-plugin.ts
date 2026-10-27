import {
  Plugin,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { Node, ResolvedPos } from "@milkdown/kit/prose/model";
import { inTableCell } from "../tables/table-pos";
import { $prose } from "@milkdown/kit/utils";
import { stateWithLiveSelection } from "../live-selection";
import { isImeKeyEvent } from "./ime";
import { alertMarker } from "../markdown/github-alert-plugin";

/** Code, maths, front matter: text kept as written. */
const isVerbatim = (node: Node) => node.isTextblock && !!node.type.spec.code;

/** The hidden `[!NOTE]` line an alert starts with. */
const opensAlert = ($pos: ResolvedPos) =>
  $pos.depth > 1 &&
  $pos.index(-1) === 0 &&
  $pos.node(-1).type.name === "blockquote" &&
  alertMarker($pos.node(-1)) != null;

/** Lines whose text must not run together: the default join poured a code
 *  block into the paragraph beside it, and selected a whole table. */
const keptApart = ($a: ResolvedPos, $b: ResolvedPos) =>
  isVerbatim($a.parent) ||
  isVerbatim($b.parent) ||
  inTableCell($a) !== inTableCell($b) ||
  opensAlert($b);

/** The caret position at the near end of the next textblock in `dir`,
 *  when no other block (a rule, an image) stands between. */
function neighbour($pos: ResolvedPos, dir: -1 | 1): ResolvedPos | null {
  const doc = $pos.doc;
  const edge = dir < 0 ? $pos.before() : $pos.after();
  const found = Selection.findFrom(doc.resolve(edge), dir, true);
  if (!(found instanceof TextSelection)) return null;
  const $near = found.$head;
  if ($near.pos !== (dir < 0 ? $near.end() : $near.start())) return null;
  const from = dir < 0 ? $near.pos : $pos.end();
  const to = dir < 0 ? $pos.start() : $near.pos;
  let between = false;
  doc.nodesBetween(from, to, (node, pos) => {
    if (pos >= from && pos + node.nodeSize <= to) between = true;
    return !between;
  });
  return between ? null : $near;
}

/** Where text starts at `$pos`: past an alert's hidden marker line, where
 *  typing would break the alert. */
function startOfText($pos: ResolvedPos): number {
  const marker = opensAlert($pos) && alertMarker($pos.node(-1));
  if (!marker) return $pos.pos;
  if (marker.hidden < $pos.parent.content.size) return $pos.pos + marker.hidden;
  const body = Selection.findFrom($pos.doc.resolve($pos.after()), 1, true);
  return body ? body.from : $pos.pos;
}

const isEmptyLine = (node: Node) =>
  node.content.size === 0 && !isVerbatim(node);

function deleteBlock(tr: Transaction, $in: ResolvedPos): boolean {
  const index = $in.index(-1);
  if (!$in.node(-1).canReplace(index, index + 1)) return false;
  tr.delete($in.before(), $in.after());
  return true;
}

/** Backspace at the start of a line kept apart from the one above: the
 *  caret goes up, or an empty line on either side goes. */
export const backspaceKeepingApart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0)
    return false;
  const $prev = neighbour($from, -1);
  if (!$prev || !keptApart($from, $prev)) return false;
  // An empty code block goes, as by default.
  if (isVerbatim($from.parent) && $from.parent.content.size === 0) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  if (isEmptyLine($from.parent) && deleteBlock(tr, $from))
    tr.setSelection(TextSelection.create(tr.doc, $prev.pos));
  else if (!($prev.parent.content.size === 0 && deleteBlock(tr, $prev)))
    tr.setSelection(TextSelection.create(tr.doc, $prev.pos));
  dispatch(tr.scrollIntoView());
  return true;
};

/** Delete at the end of a line kept apart from the next, as Backspace. */
export const deleteKeepingApart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false;
  const $next = neighbour($from, 1);
  if (!$next || !keptApart($from, $next)) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  const landing = startOfText($next);
  if (isEmptyLine($from.parent) && deleteBlock(tr, $from))
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(landing)));
  else if (!($next.parent.content.size === 0 && deleteBlock(tr, $next)))
    tr.setSelection(TextSelection.create(tr.doc, landing));
  dispatch(tr.scrollIntoView());
  return true;
};

/** Delete at the end of a line before a line in another block - a quote,
 *  a list item, out of a quote - joins their text, where the default took
 *  the next line out of its quote or list. An empty line there goes. */
export const deleteJoiningText: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || inTableCell($from)) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false;
  const $next = neighbour($from, 1);
  // Lines side by side join by default.
  if (!$next || inTableCell($next) || $next.node(-1) === $from.node(-1))
    return false;
  // A list item with more in it keeps a first line: let the default lift it.
  const host = $next.node(-1);
  if (host.childCount > 1 && !host.canReplace(0, 1)) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  if ($from.parent.content.size === 0 && deleteBlock(tr, $from))
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map($next.pos)));
  else tr.delete($from.pos, $next.pos);
  dispatch(tr.scrollIntoView());
  return true;
};

/** A selection from one line into another kept apart from it, deleted
 *  without joining what is left of the two: the default turned a code
 *  block's remaining lines into a paragraph. */
function deleteSelectionApart(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  const { $from, $to } = selection;
  if ($from.sameParent($to) || !$from.parent.isTextblock) return null;
  if (!$to.parent.isTextblock || !keptApart($from, $to)) return null;
  const tr = state.tr.delete($to.start(), $to.pos);
  tr.delete($from.pos, $from.end());
  const between = tr.mapping.map($from.after());
  const lastLine = tr.mapping.map($to.before());
  if (lastLine > between) tr.delete(between, lastLine);
  return tr.setSelection(TextSelection.create(tr.doc, $from.pos));
}

export const deleteSelectionKeepingApart: Command = (state, dispatch) => {
  const tr = deleteSelectionApart(state);
  if (!tr) return false;
  dispatch?.(tr.scrollIntoView());
  return true;
};

const onKey: Record<string, Command[]> = {
  Backspace: [deleteSelectionKeepingApart, backspaceKeepingApart],
  Delete: [deleteSelectionKeepingApart, deleteKeepingApart, deleteJoiningText],
};

export const blockJoinPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.metaKey || event.ctrlKey || event.altKey) return false;
          // Shift+Backspace is Backspace; Shift+Delete cuts on Windows.
          if (event.shiftKey && event.key !== "Backspace") return false;
          const commands = onKey[event.key];
          if (!commands || isImeKeyEvent(view, event)) return false;
          const state = stateWithLiveSelection(view);
          return commands.some((command) => command(state, view.dispatch));
        },
        handleTextInput(view, _from, _to, text) {
          if (view.composing) return false;
          const tr = deleteSelectionApart(view.state);
          if (!tr) return false;
          view.dispatch(tr.insertText(text).scrollIntoView());
          return true;
        },
      },
    }),
);
