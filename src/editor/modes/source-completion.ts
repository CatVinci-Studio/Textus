import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { isImeKeydown } from "../../utils/ime";
import {
  CONTEXT_CHARS,
  completionSession,
  type CaretContext,
  type CompletionSession,
} from "../completion/completion-session";
import {
  completionSources,
  type CompletionSource,
} from "../completion/sources";

/**
 * The rich editor's completion panel in source mode, for the sources whose
 * text reads the same as Markdown source (a link's path); a `/` command
 * builds rich blocks and stays out.
 */

/** Typed as it is: a path or a colon there completes nothing. */
const CODE = new Set(["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock"]);

function contextAt(view: EditorView): CaretContext | null {
  const { main } = view.state.selection;
  const line = view.state.doc.lineAt(main.to);
  if (main.from < line.from) return null;
  const inner = syntaxTree(view.state).resolveInner(main.to, -1);
  for (let node: typeof inner | null = inner; node; node = node.parent)
    if (CODE.has(node.name)) return null;
  const at = main.to - line.from;
  return {
    text: line.text.slice(Math.max(0, at - CONTEXT_CHARS), at),
    after: line.text.slice(at, at + CONTEXT_CHARS),
    inMath: false,
    caret: main.to,
  };
}

let sourceSources: {
  from: readonly CompletionSource[];
  kept: CompletionSource[];
} = { from: [], kept: [] };

/** The sources offered here, worked out again only when they change. */
function inSource(): readonly CompletionSource[] {
  const all = completionSources();
  if (all !== sourceSources.from)
    sourceSources = { from: all, kept: all.filter((s) => s.inSource) };
  return sourceSources.kept;
}

/** `insert` over `from`-`to`, the caret at its `$0`: its own undo step. */
function put(view: EditorView, insert: string, from: number, to: number) {
  const at = insert.indexOf("$0");
  const text = insert.replace("$0", "");
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + (at < 0 ? text.length : at) },
    annotations: isolateHistory.of("full"),
    userEvent: "input.complete",
    scrollIntoView: true,
  });
}

class SourceCompletion {
  readonly session: CompletionSession;
  destroyed = false;
  constructor(
    readonly view: EditorView,
    docPath: () => string | null,
  ) {
    this.session = completionSession({
      context: () => contextAt(view),
      path: docPath,
      sources: inSource,
      insert: (insert, from, to) => put(view, insert, from, to),
      coords: (pos) => {
        const rect = view.coordsAtPos(pos);
        if (!rect) throw new Error("not drawn");
        return rect;
      },
      focus: () => view.focus(),
    });
  }

  update(update: { docChanged: boolean; selectionSet: boolean }) {
    if (this.view.composing || !(update.docChanged || update.selectionSet))
      return;
    // After the update: the panel measures where the caret is drawn, which
    // CodeMirror refuses while it updates.
    const { docChanged } = update;
    queueMicrotask(() => {
      if (!this.destroyed) this.session.changed(docChanged);
    });
  }

  destroy() {
    this.destroyed = true;
    this.session.destroy();
  }
}

/** The panel for the source editor of the document at `docPath()`. */
export function sourceCompletion(docPath: () => string | null): Extension {
  const plugin = ViewPlugin.define(
    (view) => new SourceCompletion(view, docPath),
    {
      eventHandlers: {
        keydown(event) {
          if (
            isImeKeydown(event) ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            !this.session.key(event.key)
          )
            return false;
          event.preventDefault();
          return true;
        },
        blur() {
          this.session.key("Escape");
        },
        // What an input method committed is matched once it is in.
        compositionend() {
          setTimeout(() => {
            if (!this.destroyed && !this.view.composing) this.session.refresh();
          }, 0);
        },
      },
    },
  );
  // Its keys before the editor's own: Enter, Tab and the arrows pick.
  return Prec.highest(plugin);
}
