import { commandsCtx, editorViewCtx, type CmdKey } from "@milkdown/kit/core";
import {
  createCodeBlockCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import type { EditorRunner } from "../useEditorRunner";
import { convertList } from "../keys/block-toggles";
import { insertMathBlock, insertRule, makeTasks } from "../insert-blocks";
import { flushDomSelection } from "../modes/mode-switch";

// CmdKey<any>: the preset keys vary in payload type; none gets one here.
export function runCommand(run: EditorRunner, key: CmdKey<any>) {
  run((ctx) => {
    ctx.get(commandsCtx).call(key);
    ctx.get(editorViewCtx).focus();
  });
}

function insertHeading(run: EditorRunner, level: number) {
  run((ctx) => {
    ctx.get(commandsCtx).call(wrapInHeadingCommand.key, level);
    ctx.get(editorViewCtx).focus();
  });
}

/** A list: the block wrapped, or the other kind changed. */
function insertList(
  run: EditorRunner,
  kind: "bullet_list" | "ordered_list",
): void {
  if (run((ctx) => convertList(ctx.get(editorViewCtx), kind))) return;
  runCommand(
    run,
    kind === "bullet_list"
      ? wrapInBulletListCommand.key
      : wrapInOrderedListCommand.key,
  );
}

/** The block at the caret made `kind`, or `kind` put in after it (a
 *  formula, a table, a rule). */
export function applyBlockKind(
  run: EditorRunner,
  kind: string,
  openTableDialog: () => void,
): void {
  run((ctx) => flushDomSelection(ctx.get(editorViewCtx)));
  const level = /^h([1-6])$/.exec(kind)?.[1];
  // Milkdown's WrapInHeading turns a level below 1 into a paragraph.
  if (level || kind === "paragraph") {
    insertHeading(run, Number(level ?? 0));
    return;
  }
  const onView = (act: (view: Parameters<typeof makeTasks>[0]) => unknown) =>
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      act(view);
      view.focus();
    });
  switch (kind) {
    case "bullet-list":
    case "ordered-list":
      insertList(run, kind === "bullet-list" ? "bullet_list" : "ordered_list");
      break;
    case "task-list":
      insertList(run, "bullet_list");
      onView(makeTasks);
      break;
    case "blockquote":
      runCommand(run, wrapInBlockquoteCommand.key);
      break;
    case "callout":
      runCommand(run, wrapInBlockquoteCommand.key);
      onView(markCallout);
      break;
    case "code-block":
      runCommand(run, createCodeBlockCommand.key);
      break;
    case "math-block":
      onView(insertMathBlock);
      break;
    case "rule":
      onView(insertRule);
      break;
    case "table":
      openTableDialog();
      break;
  }
}

/** The quote the caret is in made a note callout: its marker line first. */
function markCallout(view: Parameters<typeof makeTasks>[0]): void {
  const { state } = view;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== "blockquote") continue;
    const marker = state.schema.nodes.paragraph!.create(
      null,
      state.schema.text("[!NOTE]"),
    );
    view.dispatch(state.tr.insert($from.start(depth), marker));
    return;
  }
}
