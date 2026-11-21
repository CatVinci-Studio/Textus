import type { Ctx } from "@milkdown/kit/ctx";
import { parserCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { metaDecorations } from "../../editor/meta-decorations";
import { markChangeSource } from "../../editor/change-source";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  addIssueSource,
  type IssueSpec,
} from "../../editor/issues/issue-sources";
import {
  diagnose,
  hasDiagnosticProviders,
  onDiagnosticProviders,
  type BlockFix,
  type PluginDiagnostic,
} from "../../plugins/contributions/diagnostics";
import { askAtRest, answerRange } from "./rest-asking";
import { publishSlips } from "../../editor/issues/slips-by-tab";
import "./plugin-diagnostics.css";

/**
 * The slips plugins find, underlined as the grammar check's are and
 * explained on the same card: its fix, if it has one, and Ignore.
 */

const key = new PluginKey<DecorationSet>("plugin-diagnostics");
const SOURCE = "plugins";

type Found = PluginDiagnostic & { plugin: string; name: string };
type DiagnosticSpec = IssueSpec & { plugin: string };

/** Slips the user set aside this session, by who found them and what. */
const ignored = new Set<string>();
const ignoreKey = (plugin: string, issue: string, original = "") =>
  `${plugin}\n${issue}\n${original}`;

addIssueSource(SOURCE, {
  key,
  changeSource: "plugin",
  ignore(view, spec) {
    const { plugin } = spec as DiagnosticSpec;
    const name = ignoreKey(plugin, spec.issue, spec.original);
    ignored.add(name);
    const set = key.getState(view.state) ?? DecorationSet.empty;
    const gone = set.find(undefined, undefined, (s) => {
      const d = s as DiagnosticSpec;
      return ignoreKey(d.plugin, d.issue, d.original) === name;
    });
    view.dispatch(
      view.state.tr
        .setMeta(key, set.remove(gone))
        .setMeta("addToHistory", false),
    );
  },
});

/** The block made anew from the fix's Markdown, if it is still the block
 *  the fix was for. */
function replaceBlock(
  ctx: Ctx,
  view: EditorView,
  was: ProseNode,
  fix: BlockFix,
): boolean {
  const { doc } = view.state;
  let at = -1;
  doc.forEach((node, pos) => {
    if (at < 0 && node === was) at = pos;
  });
  if (at < 0) return false;
  const made = ctx.get(parserCtx)(fix.markdown);
  if (!made || typeof made === "string") return false;
  view.dispatch(
    markChangeSource(
      view.state.tr.replaceWith(at, at + was.nodeSize, made.content),
      "plugin",
    ),
  );
  return true;
}

function drawSlip(
  ctx: Ctx,
  block: ProseNode,
  pos: number,
  found: Found,
): Decoration[] {
  const [from, to] = answerRange(block, pos, found.anchor);
  if (to <= from) return [];
  const original = block.textBetween(from - pos - 1, to - pos - 1);
  if (ignored.has(ignoreKey(found.plugin, found.message, original))) return [];
  const blockFix = typeof found.fix === "object" ? found.fix : undefined;
  return [
    Decoration.inline(
      from,
      to,
      {
        class: `grammar-issue plugin-issue plugin-issue-${found.severity}`,
        "data-plugin": found.plugin,
        "data-editor-mark": "",
      },
      {
        source: SOURCE,
        plugin: found.plugin,
        issue: found.message,
        suggestion: typeof found.fix === "string" ? found.fix : undefined,
        original,
        label: found.name,
        fix: blockFix && {
          label: blockFix.label,
          apply: (view) => replaceBlock(ctx, view, block, blockFix),
        },
      } satisfies DiagnosticSpec,
    ),
  ];
}

/** The caret into the slip `spec` is of, where it is now: its card opens.
 *  The editor takes the keys first: an editor without them scrolls to no
 *  selection, and WebKit, given them after, scrolls back to the old one. */
function goTo(view: EditorView, spec: DiagnosticSpec) {
  const deco = key
    .getState(view.state)
    ?.find(undefined, undefined, (s) => s === spec)[0];
  if (!deco) return;
  view.focus();
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, deco.from))
      .scrollIntoView(),
  );
}

/** The slips drawn, for the tab's corner, whenever they change. */
function tellSlips(view: EditorView) {
  let shown: DecorationSet | undefined;
  let tab: string | undefined;
  return {
    update() {
      const set = key.getState(view.state);
      if (set === shown) return;
      shown = set;
      tab ??= (view.dom.closest("[data-tab-id]") as HTMLElement | null)?.dataset
        .tabId;
      if (!tab) return;
      publishSlips(
        tab,
        (set?.find() ?? []).map((deco) => {
          const spec = deco.spec as DiagnosticSpec;
          return {
            label: spec.label ?? "",
            message: spec.issue,
            go: () => goTo(view, spec),
          };
        }),
      );
    },
    destroy() {
      if (tab) publishSlips(tab, []);
    },
  };
}

/** The plugins' checks of the blocks in sight, once the document rests. */
export const pluginDiagnostics = (docPath: {
  readonly current: string | null;
}) =>
  $prose(
    (ctx) =>
      new Plugin<DecorationSet>({
        key,
        state: metaDecorations(key),
        props: { decorations: (state) => key.getState(state) },
        view: (view) => {
          const asking = askAtRest(ctx, view, docPath, {
            key,
            active: hasDiagnosticProviders,
            subscribe: onDiagnosticProviders,
            ask: diagnose,
            draw: (block, pos, found) => drawSlip(ctx, block, pos, found),
          });
          const slips = tellSlips(view);
          return {
            update(updated, prevState) {
              asking.update?.(updated, prevState);
              slips.update();
            },
            destroy() {
              asking.destroy?.();
              slips.destroy();
            },
          };
        },
      }),
  );
