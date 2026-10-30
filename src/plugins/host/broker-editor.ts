import { resolveBlockEdit } from "../../ai/doc-blocks";
import {
  EDIT_ACTIONS,
  type EditAction,
  type EditProposal,
} from "../../ai/types";
import {
  releaseKeys,
  runEditorOp,
  setKeyCapture,
  type EditorOp,
} from "../contributions/editor-input";
import { outlineOf } from "../contributions/status-items";
import { getActiveDocument, type ActiveDocumentAccess } from "../app-bridge";
import {
  addHoverProvider,
  removeHoverProvider,
  type HoverCard,
} from "../contributions/hover-providers";
import {
  addDecorationProvider,
  removeDecorationProvider,
  type PluginDecoration,
} from "../contributions/decorations";
import { optionalStr, type Params, type PluginScope } from "./broker-scope";
import { FILE_RELOADED_EVENT } from "../../utils/events";
import { emitPluginEvent } from "../app-bridge";

// The document in front read again from disk: plugins hear its new text
// came from there. Its editor remounts, so it reports no change itself.
window.addEventListener(FILE_RELOADED_EVENT, (e) => {
  const path = (e as CustomEvent<string>).detail;
  if (getActiveDocument()?.path === path)
    emitPluginEvent("documentChange", { path, source: "disk" });
});

let proposalCounter = 0;

/** A change as the runtime sends it, placed by block ids against the
 *  document as it is now, as Textus AI's edits are. */
function editOf(
  doc: ActiveDocumentAccess,
  change: unknown,
  reason?: string,
): EditProposal {
  if (!change || typeof change !== "object")
    throw new Error("A change is { action, ... }.");
  const c = change as Record<string, unknown>;
  const action = (c.action ?? "insert_at_cursor") as EditAction;
  if (!EDIT_ACTIONS.includes(action))
    throw new Error(`No edit action ${String(action)}.`);
  const text = optionalStr(c.text);
  const anchor = optionalStr(c.anchor);
  const block = optionalStr(c.block);
  const target = block
    ? resolveBlockEdit(
        doc.blocks(),
        {
          action,
          block,
          lastBlock: optionalStr(c.lastBlock),
          anchor,
          text: text ?? "",
        },
        true,
      )
    : null;
  if (block && !target)
    throw new Error(
      `No block ${block} in the document now, or its words aren't in it once.`,
    );
  return {
    action,
    text,
    ...(target ? { ...target, action: target.action as EditAction } : {}),
    ...(reason ? { reason } : {}),
  };
}

/**
 * A plugin's calls on the document in front: reading it, changing it at once
 * or as a proposal, going to a place in it, and what it adds while the user
 * types (hover cards, marks, the keyboard).
 */
export function editorHandlers(p: PluginScope) {
  const doc = (
    permission: "editor.read" | "editor.write" | "editor.propose",
  ) => {
    p.need(permission);
    return getActiveDocument();
  };
  const open = (permission: "editor.write" | "editor.propose") => {
    const d = doc(permission);
    if (!d) throw new Error("No document is open.");
    return d;
  };
  return {
    "editor.getPath": () => doc("editor.read")?.path ?? null,
    "editor.getText": () => doc("editor.read")?.text() ?? null,
    "editor.getSelection": () => doc("editor.read")?.selection() ?? null,
    "editor.getBlocks": () => doc("editor.read")?.blocks() ?? null,
    "editor.getOutline": () => {
      const text = doc("editor.read")?.text();
      return text === undefined ? null : outlineOf(text);
    },
    "editor.edit": ({ changes }: Params) => {
      const d = open("editor.write");
      const list = Array.isArray(changes) ? changes : [changes];
      return d.edit(list.map((change) => editOf(d, change)));
    },
    "editor.propose": ({ change, reason }: Params) => {
      const d = open("editor.propose");
      const said = optionalStr(reason);
      return d.propose(
        `plugin-${p.id}-${++proposalCounter}`,
        editOf(d, change, `${p.name()}${said ? `: ${said}` : ""}`),
      );
    },
    "editor.reveal": ({ location }: Params) => {
      const d = getActiveDocument();
      if (!d || !location || typeof location !== "object") return false;
      const l = location as Record<string, unknown>;
      return d.reveal({
        line: typeof l.line === "number" ? l.line : undefined,
        heading: optionalStr(l.heading),
        block: optionalStr(l.block),
        text: optionalStr(l.text),
      });
    },
    "editor.registerHover": () => {
      p.need("editor.read");
      addHoverProvider(p.id, (target) =>
        p.request<HoverCard | null>("$provideHover", { target }),
      );
    },
    "editor.registerDecorations": () => {
      p.need("editor.read");
      addDecorationProvider(p.id, (blocks) =>
        p.request<PluginDecoration[]>("$decorate", { blocks }),
      );
    },
    "editor.unregisterDecorations": () => removeDecorationProvider(p.id),
    "editor.captureKeys": (capture: Params | null) => {
      p.need("editor.input");
      setKeyCapture(
        p.id,
        capture && {
          mode: capture.mode === "all" ? "all" : "some",
          keys: Array.isArray(capture.keys) ? capture.keys.map(String) : [],
        },
        (key) => p.event("editorKey", key),
      );
    },
    "editor.exec": (op: EditorOp) => {
      p.need("editor.input");
      return runEditorOp(p.id, op);
    },
  };
}

/** A plugin stopped: what it added to the editor goes. */
export function stopPluginEditor(plugin: string): void {
  releaseKeys(plugin);
  removeHoverProvider(plugin);
  removeDecorationProvider(plugin);
}
