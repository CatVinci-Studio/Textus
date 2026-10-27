import type { EditorView } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { createDebouncedTask } from "./debounced-task";
import { scalarToUtf16Offset, textOffsetToDocPos } from "../doc-text";
import { pausesFeatures } from "../../editor/large-doc";
import type { FoldAttention } from "../../editor/html/details-fold";
import { ai } from "../../platform/ipc";
import { AiNoticeError } from "../../utils/error-text";

export const grammarKey = new PluginKey("grammar-check");
const DEBOUNCE_MS = 1500;
const MIN_PARAGRAPH_CHARS = 12;

export interface GrammarIssue {
  /** The writing-rules engine's rule id, when the issue came from it
   *  rather than the model. */
  rule?: string;
  /** Unicode-scalar offsets into the checked paragraph (backend-verified). */
  start: number;
  end: number;
  issue: string;
  suggestion: string;
  /** Exact text of the span - re-verified before decorating and applying. */
  original?: string;
}

/** Whether the paragraph still reads as at request time; if not, the
 *  response's offsets would land beside the text they meant. */
function paragraphUnchanged(
  view: EditorView,
  contentStart: number,
  text: string,
): boolean {
  try {
    const $pos = view.state.doc.resolve(contentStart);
    return $pos.parent.isTextblock && $pos.parent.textContent === text;
  } catch {
    return false; // position no longer exists
  }
}

/// Checks the caret's paragraph now, skipping the debounce. Unlike the
/// typing-triggered path, it throws on failure.
export async function triggerGrammarCheckNow(
  view: EditorView,
  provider: string,
  strictness: string,
  model: string | null,
  /** The document's project, whose writing conventions the check follows. */
  project: { docPath: string | null; workspaceRoot: string | null } = {
    docPath: null,
    workspaceRoot: null,
  },
  /** The app's language, for the explanations. */
  uiLanguage: string | null = null,
): Promise<void> {
  const { $from } = view.state.selection;
  const para = $from.parent;
  if (!para.isTextblock || para.type.spec.code)
    throw new AiNoticeError("grammar-needs-paragraph");

  const text = para.textContent;
  const checked = checkedText(para);
  if (!checked.split(CODE_MASK).join("").trim())
    throw new AiNoticeError("grammar-empty-paragraph");

  const contentStart = $from.start($from.depth);
  const issues = await ai.grammarCheck(
    provider,
    checked,
    strictness,
    model,
    project,
    uiLanguage,
  );
  if (!paragraphUnchanged(view, contentStart, text)) {
    throw new AiNoticeError("grammar-paragraph-changed");
  }
  if (!issues?.length) throw new AiNoticeError("grammar-no-issues");

  view.dispatch(
    view.state.tr.setMeta(
      grammarKey,
      paragraphMeta(contentStart, para, issues),
    ),
  );
}

/// Each check replaces the issues of only the paragraph it checked.
type GrammarMeta =
  | { type: "paragraph"; from: number; to: number; decorations: Decoration[] }
  | { type: "ignore"; original: string; suggestion: string }
  | { type: "clear" };

/** Replaces the underlines of the paragraph at `contentStart` with `issues`. */
function paragraphMeta(
  contentStart: number,
  para: ProseNode,
  issues: GrammarIssue[],
): GrammarMeta {
  return {
    type: "paragraph",
    from: contentStart,
    to: contentStart + para.content.size,
    decorations: issuesToDecorations(para, issues, contentStart),
  };
}

/// Corrections the user dismissed this session ("Ignore"): the same fix on
/// the same text isn't offered again, in any paragraph.
const ignored = new Set<string>();
const ignoreKey = (original: string | undefined, suggestion: string) =>
  `${original ?? ""}\u0000${suggestion}`;

/// Dismisses one suggestion: its underline goes, and it won't come back.
export function ignoreGrammarIssue(
  view: EditorView,
  original: string | undefined,
  suggestion: string,
): void {
  ignored.add(ignoreKey(original, suggestion));
  view.dispatch(
    view.state.tr.setMeta(grammarKey, {
      type: "ignore",
      original: original ?? "",
      suggestion,
    } satisfies GrammarMeta),
  );
}

/// Takes every underline away - Textus AI was turned off. Turned back on,
/// the paragraphs are checked again as they are edited.
export function clearGrammarIssues(view: EditorView): void {
  const set = grammarKey.getState(view.state) as DecorationSet | undefined;
  if (!set || set === DecorationSet.empty) return;
  view.dispatch(
    view.state.tr
      .setMeta(grammarKey, { type: "clear" } satisfies GrammarMeta)
      .setMeta("addToHistory", false),
  );
}

/// The issue under the caret, if the caret sits inside an underline.
export function grammarIssueAt(
  state: EditorState,
  pos: number,
): Decoration | null {
  return (
    grammarKey
      .getState(state)
      ?.find(pos, pos)
      .find((deco: Decoration) => deco.from <= pos && pos <= deco.to) ?? null
  );
}

/// The popover reads the issue off the decoration's spec, not a `title`
/// attribute, so it can offer a real Apply button.
export interface GrammarDecorationSpec {
  issue: string;
  suggestion: string;
  /** Set when the writing-rules engine found it (labelled as such). */
  rule?: string;
  /** What the highlighted range must still say for Apply to act. */
  original?: string;
}

/** Masks inline code, one unit per unit so offsets still match: in mixed
 *  Chinese and English, code drew false fixes. */
const CODE_MASK = "\u2022";

export function checkedText(para: ProseNode): string {
  const text = para.textContent;
  let masked = "";
  let end = 0;
  para.descendants((node, pos) => {
    if (!node.isText || !node.marks.some((mark) => mark.type.spec.code))
      return true;
    const start = para.textBetween(0, pos, "").length;
    masked += text.slice(end, start) + CODE_MASK.repeat(node.text!.length);
    end = start + node.text!.length;
    return true;
  });
  return masked + text.slice(end);
}

/** Whether any text in [from, to) of the paragraph (positions relative to
 *  its content) carries a code mark - inline code. */
export function touchesCode(
  para: ProseNode,
  from: number,
  to: number,
): boolean {
  let code = false;
  para.nodesBetween(from, to, (node) => {
    if (node.marks.some((mark) => mark.type.spec.code)) code = true;
    return !code;
  });
  return code;
}

export function issuesToDecorations(
  para: ProseNode,
  issues: GrammarIssue[],
  contentStart: number,
): Decoration[] {
  const text = checkedText(para);
  const decorations: Decoration[] = [];
  // Overlaps dropped: stacked highlights show as one range whose popover
  // only reaches the first.
  const ordered = [...issues].sort((a, b) => a.start - b.start);
  let lastEnd = -1;
  for (const issue of ordered) {
    if (issue.start < lastEnd) continue;
    if (ignored.has(ignoreKey(issue.original, issue.suggestion))) continue;
    // A "fix" that changes nothing (再三考虑 -> 再三考虑): an underline on
    // correct text whose Apply does nothing.
    if (issue.suggestion === issue.original) continue;
    // Backend offsets count Unicode scalars; JS strings (and ProseMirror
    // text offsets) count UTF-16 units.
    const start16 = scalarToUtf16Offset(text, issue.start);
    const end16 = scalarToUtf16Offset(text, issue.end);
    if (
      issue.original !== undefined &&
      text.slice(start16, end16) !== issue.original
    )
      continue;
    const from = textOffsetToDocPos(para, contentStart, start16);
    const to = textOffsetToDocPos(para, contentStart, end16);
    if (from === null || to === null || from >= to) continue; // range the model made up - drop it
    // Inline code loses its backticks in the checked text, so `npm instal`
    // looks like a typo. Code is never the checker's to fix.
    if (touchesCode(para, from - contentStart, to - contentStart)) continue;
    lastEnd = issue.end;
    decorations.push(
      Decoration.inline(from, to, { class: "grammar-issue" }, {
        issue: issue.issue,
        suggestion: issue.suggestion,
        original: issue.original,
        rule: issue.rule,
      } satisfies GrammarDecorationSpec),
    );
  }
  return decorations;
}

export function createGrammarCheckPlugin(options: {
  enabled: () => boolean;
  provider: () => string;
  model: () => string | null;
  strictness: () => string;
  /** The document's project folder, for its writing conventions. */
  project?: () => { docPath: string | null; workspaceRoot: string | null };
  /** The app's language, which the explanations are written in. */
  uiLanguage?: () => string;
}) {
  const debounced = createDebouncedTask(DEBOUNCE_MS);

  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key: grammarKey,
        // An underline that lands in text folded in a <details> (a check
        // asked for by hand with the caret there) opens it.
        foldAttention: ((state) =>
          (grammarKey.getState(state) as DecorationSet | undefined)
            ?.find()
            .map((deco) => {
              const spec = deco.spec as GrammarDecorationSpec;
              return {
                key: `grammar:${spec.issue}\n${spec.original ?? ""}`,
                from: deco.from,
                to: deco.to,
              };
            }) ?? []) satisfies FoldAttention,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, prev) {
            const meta = tr.getMeta(grammarKey) as GrammarMeta | undefined;
            if (meta?.type === "paragraph") {
              return prev
                .remove(prev.find(meta.from, meta.to))
                .add(tr.doc, meta.decorations);
            }
            if (meta?.type === "clear") return DecorationSet.empty;
            if (meta?.type === "ignore") {
              return prev.remove(
                prev.find().filter((deco) => {
                  const spec = deco.spec as GrammarDecorationSpec;
                  return (
                    (spec.original ?? "") === meta.original &&
                    spec.suggestion === meta.suggestion
                  );
                }),
              );
            }
            if (!tr.docChanged) return prev;
            // A highlight whose text no longer says what the issue was about
            // is done, so applying a fix clears its underline.
            const mapped = prev.map(tr.mapping, tr.doc);
            const stale = mapped.find().filter((deco) => {
              const spec = deco.spec as GrammarDecorationSpec;
              return (
                spec.original !== undefined &&
                tr.doc.textBetween(deco.from, deco.to) !== spec.original
              );
            });
            return stale.length > 0 ? mapped.remove(stale) : mapped;
          },
        },
        props: {
          decorations(state) {
            return grammarKey.getState(state);
          },
          // Alt+Enter applies the suggestion under the caret.
          handleKeyDown(view, event) {
            if (!event.altKey || event.key !== "Enter") return false;
            const { selection } = view.state;
            if (!selection.empty) return false;
            const deco = grammarIssueAt(view.state, selection.from);
            if (!deco) return false;
            const spec = deco.spec as GrammarDecorationSpec;
            if (
              spec.original !== undefined &&
              view.state.doc.textBetween(deco.from, deco.to) !== spec.original
            )
              return false;
            event.preventDefault();
            view.dispatch(
              view.state.tr.insertText(spec.suggestion, deco.from, deco.to),
            );
            return true;
          },
        },
        view() {
          return {
            update(view, prevState) {
              if (!options.enabled()) return;
              if (view.composing) return;
              if (pausesFeatures(view.state.doc)) return;
              if (view.state.doc.eq(prevState.doc)) return;
              debounced.cancel();

              const { $from } = view.state.selection;
              const para = $from.parent;
              if (!para.isTextblock || para.type.spec.code) return;

              const text = para.textContent;
              const checked = checkedText(para);
              if (
                checked.split(CODE_MASK).join("").trim().length <
                MIN_PARAGRAPH_CHARS
              )
                return;

              const contentStart = $from.start($from.depth);

              debounced.schedule(async (isCurrent) => {
                // Turned off while the request waited out the debounce.
                if (!options.enabled()) return;
                let issues: GrammarIssue[];
                try {
                  issues = await ai.grammarCheck(
                    options.provider(),
                    checked,
                    options.strictness(),
                    options.model(),
                    options.project?.(),
                    options.uiLanguage?.() ?? null,
                  );
                } catch (err) {
                  // Quiet in the UI while typing, but logged.
                  console.error("[grammar-check] request failed:", err);
                  return;
                }
                if (!isCurrent() || !options.enabled()) return;
                if (!view.hasFocus()) return;
                if (view.composing) return; // mid-IME - offsets would go stale the moment it commits
                if (!paragraphUnchanged(view, contentStart, text)) return;
                if (!issues?.length) return;

                view.dispatch(
                  view.state.tr.setMeta(
                    grammarKey,
                    paragraphMeta(contentStart, para, issues),
                  ),
                );
              });
            },
            destroy() {
              debounced.cancel();
            },
          };
        },
      }),
  );
}
