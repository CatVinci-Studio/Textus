import { addSlashItems, blockTypeList } from "../contributions/slash-commands";
import { isRecord } from "../../utils/is-record";
import { fill } from "../../i18n/fill";
import {
  addOutlineProvider,
  removeOutlineProvider,
} from "../contributions/outline-providers";
import {
  addPasteHandler,
  pastePattern,
  removePasteHandler,
} from "../contributions/paste-handlers";
import {
  addDropHandler,
  dropMatch,
  removeDropHandler,
  type DroppedFileInfo,
} from "../contributions/drop-handlers";
import { resolveBlockEdit } from "../../editor/markdown/doc-blocks";
import type { EditProposal } from "../../ai/types";
import {
  EDIT_ACTIONS,
  type EditAction,
} from "../../editor/markdown/edit-actions";
import {
  keyHolder,
  releaseKeys,
  setKeyCapture,
} from "../contributions/editor-input";
import { runEditorOp, type EditorOp } from "../contributions/editor-ops";
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
import { addSyntax, removeSyntaxes } from "../contributions/syntax";
import {
  addDiagnosticProvider,
  removeDiagnosticProviders,
  type PluginDiagnostic,
} from "../contributions/diagnostics";
import {
  optionalStr,
  str,
  type Params,
  type PluginScope,
} from "./broker-scope";
import { FILE_RELOADED_EVENT } from "../../utils/events";
import { showNotice } from "../../engine/controls/notices";
import { logPluginMessage } from "../store/plugin-log";
import { emitPluginEvent } from "../app-bridge";

// The document in front read again from disk: plugins hear its new text
// came from there. Its editor remounts, so it reports no change itself.
window.addEventListener(FILE_RELOADED_EVENT, (e) => {
  const path = (e as CustomEvent<string>).detail;
  if (getActiveDocument()?.path === path)
    emitPluginEvent("documentChange", { path, source: "disk" });
});

let proposalCounter = 0;

/** Plugins already told this session that another has the keyboard. */
const toldKeysTaken = new Set<string>();

/** One way of typing at a time: the later plugin is refused, told once. */
function keysTaken(p: PluginScope) {
  const holder = keyHolder();
  if (!holder) return;
  logPluginMessage(p.id, "warn", `The keyboard is held by ${holder.id}.`);
  if (toldKeysTaken.has(p.id)) return;
  toldKeysTaken.add(p.id);
  showNotice(
    fill(p.t().pluginKeysTaken, { name: p.name(), holder: holder.name }),
    { tone: "warning" },
  );
}

/** A change as the runtime sends it, placed by block ids against the
 *  document as it is now, as Textus AI's edits are. */
function editOf(
  doc: ActiveDocumentAccess,
  change: unknown,
  reason?: string,
): EditProposal {
  if (!isRecord(change)) throw new Error("A change is { action, ... }.");
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
/** The block types each plugin registered, each with what takes it away. */
const registeredBlockTypes = new Map<string, Map<string, () => void>>();

export function editorHandlers(p: PluginScope) {
  const blockTypes =
    registeredBlockTypes.get(p.id) ??
    registeredBlockTypes.set(p.id, new Map()).get(p.id)!;
  // Each call's permission is checked before it runs (api-permissions.ts).
  const doc = getActiveDocument;
  const open = () => {
    const d = doc();
    if (!d) throw new Error("No document is open.");
    return d;
  };
  return {
    "editor.getPath": () => doc()?.path ?? null,
    "editor.getText": () => doc()?.text() ?? null,
    "editor.getSelection": () => doc()?.selection() ?? null,
    "editor.getCursor": () => {
      const d = doc();
      const head = d?.cursor()?.head;
      return d?.path && head ? { path: d.path, ...head } : null;
    },
    "editor.getBlocks": () => doc()?.blocks() ?? null,
    "editor.getOutline": () => {
      const text = doc()?.text();
      return text === undefined ? null : outlineOf(text);
    },
    "editor.edit": ({ changes }: Params) => {
      const d = open();
      const list = Array.isArray(changes) ? changes : [changes];
      return d.edit(list.map((change) => editOf(d, change)));
    },
    "editor.propose": ({ change, reason }: Params) => {
      const d = open();
      const said = optionalStr(reason);
      return d.propose(
        `plugin-${p.id}-${++proposalCounter}`,
        editOf(d, change, `${p.name()}${said ? `: ${said}` : ""}`),
      );
    },
    "editor.reveal": ({ location }: Params) => {
      const d = getActiveDocument();
      if (!d || !isRecord(location)) return false;
      const l = location as Record<string, unknown>;
      return d.reveal({
        line: typeof l.line === "number" ? l.line : undefined,
        heading: optionalStr(l.heading),
        block: optionalStr(l.block),
        text: optionalStr(l.text),
      });
    },
    "editor.registerPasteHandler": ({ id, pattern }: Params) =>
      addPasteHandler(
        p.id,
        str(id, "id"),
        pastePattern(str(pattern, "pattern")),
        (text) => p.request<string | null>("$providePaste", { id, text }),
      ),
    "editor.unregisterPasteHandler": ({ id }: Params) =>
      removePasteHandler(p.id, str(id, "id")),
    "editor.registerDropHandler": ({ id, match }: Params) =>
      addDropHandler(p.id, str(id, "id"), dropMatch(match), (file) =>
        p.request<string | null>("$provideDrop", {
          id,
          file: file satisfies DroppedFileInfo,
        }),
      ),
    "editor.unregisterDropHandler": ({ id }: Params) =>
      removeDropHandler(p.id, str(id, "id")),
    "editor.registerOutline": () =>
      addOutlineProvider(p.id, (blocks) =>
        p.request<unknown>("$provideOutline", { blocks }),
      ),
    "editor.unregisterOutline": () => removeOutlineProvider(p.id),
    "editor.blockTypes": () => blockTypeList(),
    "editor.registerBlockType": ({ id, label, keywords }: Params) => {
      const type = str(id, "id");
      blockTypes.get(type)?.();
      blockTypes.set(
        type,
        addSlashItems(
          p.id,
          [
            {
              label: str(label, "label"),
              detail: p.name(),
              keywords: typeof keywords === "string" ? keywords : undefined,
              shown: () => true,
              run: () =>
                void p
                  .request("$insertBlockType", { id: type })
                  .catch(() => {}),
            },
          ],
          `${p.id}#${type}`,
        ),
      );
    },
    "editor.unregisterBlockType": ({ id }: Params) => {
      const type = str(id, "id");
      blockTypes.get(type)?.();
      blockTypes.delete(type);
    },
    "editor.registerHover": () => {
      addHoverProvider(
        p.id,
        (target) => p.request<HoverCard | null>("$provideHover", { target }),
        p.manifest().contributes.hovers.length > 0,
      );
    },
    "editor.unregisterHover": () => removeHoverProvider(p.id),
    "editor.registerDecorations": () => {
      addDecorationProvider(p.id, (blocks, all, path) =>
        p.request<PluginDecoration[]>("$decorate", {
          blocks,
          document: { blocks: all, path },
        }),
      );
    },
    "editor.unregisterDecorations": () => removeDecorationProvider(p.id),
    "editor.registerDiagnostics": ({ id }: Params) => {
      const name = str(id, "id");
      addDiagnosticProvider(`${p.id}\n${name}`, {
        plugin: p.id,
        name: p.name(),
        ask: (blocks, all, path) =>
          p.request<PluginDiagnostic[]>("$diagnose", {
            id: name,
            blocks,
            document: { blocks: all, path },
          }),
      });
    },
    "editor.unregisterDiagnostics": ({ id }: Params) =>
      removeDiagnosticProviders((key) => key === `${p.id}\n${String(id)}`),
    "editor.registerSyntax": (syntax: Params) => {
      const name = str(syntax.id, "id");
      const added = addSyntax(`${p.id}\n${name}`, {
        pattern: str(syntax.pattern, "pattern"),
        flags: typeof syntax.flags === "string" ? syntax.flags : "",
        style: str(syntax.style, "style"),
        tone: typeof syntax.tone === "string" ? syntax.tone : undefined,
      });
      if (!added)
        throw new Error(
          `syntax "${name}": a pattern that matches some text, and a style Textus has`,
        );
    },
    "editor.unregisterSyntax": ({ id }: Params) =>
      removeSyntaxes((key) => key === `${p.id}\n${String(id)}`),
    "editor.captureKeys": (capture: Params | null) => {
      const held = setKeyCapture(
        p.id,
        capture && {
          mode: capture.mode === "all" ? "all" : "some",
          keys: Array.isArray(capture.keys) ? capture.keys.map(String) : [],
        },
        (key) => p.event("editorKey", key),
        p.name(),
      );
      if (!held && capture) keysTaken(p);
      return held;
    },
    "editor.exec": (op: EditorOp) => {
      return runEditorOp(p.id, op);
    },
  };
}

/** A plugin stopped: what it added to the editor goes. */
export function stopPluginEditor(plugin: string): void {
  releaseKeys(plugin);
  removeHoverProvider(plugin);
  removeDecorationProvider(plugin);
  removeDiagnosticProviders((_key, provider) => provider.plugin === plugin);
  removeSyntaxes((key) => key.startsWith(`${plugin}\n`));
  for (const remove of registeredBlockTypes.get(plugin)?.values() ?? [])
    remove();
  registeredBlockTypes.delete(plugin);
}
