import type { EditorState, PluginKey } from "@milkdown/kit/prose/state";
import type {
  Decoration,
  DecorationSet,
  EditorView,
} from "@milkdown/kit/prose/view";
import { markChangeSource, type ChangeSource } from "../change-source";

/**
 * The underlined slips in the text and the one card that explains them:
 * the grammar check's, and the plugins' diagnostics. Each source keeps its
 * underlines in its own plugin state; the card finds them all here.
 */

/** What an underline says, kept on its decoration. */
export interface IssueSpec {
  /** Its source's name, as registered. */
  source: string;
  issue: string;
  /** What the words become; none when there is no fix to apply. */
  suggestion?: string;
  /** What the words must still say for the fix to go in. */
  original?: string;
  /** The grammar check's writing-rules id. */
  rule?: string;
  /** Who found it, named on the card in place of the kind of slip. */
  label?: string;
  /** A fix that isn't a change of the words (a block's Markdown made
   *  anew): its button's label, and what applies it - false when the text
   *  has moved on since. */
  fix?: { label?: string; apply(view: EditorView): boolean };
}

interface IssueSource {
  key: PluginKey<DecorationSet>;
  /** Who a fix is recorded as having made. */
  changeSource: ChangeSource;
  /** Hides the underline (and those like it) from now on. */
  ignore(view: EditorView, spec: IssueSpec): void;
}

const sources = new Map<string, IssueSource>();

export function addIssueSource(name: string, source: IssueSource): void {
  sources.set(name, source);
}

export const issueSource = (spec: IssueSpec): IssueSource | undefined =>
  sources.get(spec.source);

/** Every source's underlines between `from` and `to` (all without), in
 *  order. */
export function issuesIn(
  state: EditorState,
  from?: number,
  to?: number,
): Decoration[] {
  return [...sources.values()]
    .flatMap(
      (s) => (s.key.getState(state)?.find(from, to) ?? []) as Decoration[],
    )
    .sort((a, b) => a.from - b.from || a.to - b.to);
}

/** The underline at `pos`, if any. */
export function issueAt(state: EditorState, pos: number): Decoration | null {
  return (
    issuesIn(state, pos, pos).find((d) => d.from <= pos && pos <= d.to) ?? null
  );
}

/** Alt+Enter: the fix under the caret goes in, if it has one and the words
 *  still say what it was for. */
export function applyIssueKey(view: EditorView, event: KeyboardEvent): boolean {
  if (!event.altKey || event.key !== "Enter") return false;
  const { selection } = view.state;
  if (!selection.empty) return false;
  const deco = issueAt(view.state, selection.from);
  const spec = deco?.spec as IssueSpec | undefined;
  if (spec?.fix) {
    if (!spec.fix.apply(view)) return false;
    event.preventDefault();
    return true;
  }
  const source = spec && issueSource(spec);
  if (!deco || !spec || !source || spec.suggestion === undefined) return false;
  if (
    spec.original !== undefined &&
    view.state.doc.textBetween(deco.from, deco.to) !== spec.original
  )
    return false;
  event.preventDefault();
  view.dispatch(
    markChangeSource(
      view.state.tr.insertText(spec.suggestion, deco.from, deco.to),
      source.changeSource,
    ),
  );
  return true;
}
