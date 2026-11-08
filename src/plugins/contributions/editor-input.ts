import { Plugin } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isMacPlatform } from "../../platform/os";
import { keyName } from "./editor-keys";
import { isImeKeydown } from "../../utils/ime";
import { inputSourceIpc } from "../../platform/ipc-app";

import {
  NO_FLASH,
  clearFlash,
  held,
  inputKey,
  setCursorStyle,
  type InputState,
  type KeyCapture,
} from "./editor-input-state";
/**
 * A plugin that takes over the editor's keyboard (Vim, Emacs). A sandboxed
 * plugin can't answer a keydown in time, so the editor holds back the keys it
 * asked for beforehand and hands them over. Its editing actions are taken
 * only just after such a key: a plugin can't change the document unprompted.
 */

let roman = false;

/** While every key is a command (Vim's normal mode), an input method would
 *  make text of them: the window takes Roman input only, the user's own
 *  source coming back once the editor has its keys again or loses focus. */
function syncRomanInput(again = false) {
  const want =
    held.owner?.capture.mode === "all" && !!held.view && held.view.hasFocus();
  if (want === roman && !again) return;
  roman = want;
  void inputSourceIpc.setRoman(want).catch(() => {});
}

/** Gives `plugin` the keys `capture` names, delivered to `deliver`; null
 *  gives back its own capture. False while another plugin holds them. */
export function setKeyCapture(
  plugin: string,
  capture: KeyCapture | null,
  deliver: (key: string) => void,
  name = plugin,
): boolean {
  if (held.owner && held.owner.plugin !== plugin) return false;
  if (!capture) {
    if (held.owner) releaseKeys(plugin);
    return true;
  }
  held.owner = {
    plugin,
    name,
    capture,
    deliver,
    lastKeyAt: held.owner?.lastKeyAt ?? 0,
  };
  syncRomanInput();
  return true;
}

/** The plugin holding the keyboard, if one does. */
export function keyHolder(): { id: string; name: string } | null {
  return held.owner && { id: held.owner.plugin, name: held.owner.name };
}

/** Lets go of whatever `plugin` held: it stopped. */
export function releaseKeys(plugin: string): void {
  if (held.owner?.plugin !== plugin) return;
  held.owner = null;
  setCursorStyle("bar");
  clearFlash();
  syncRomanInput();
}

function captures(event: KeyboardEvent, capture: KeyCapture): string | null {
  if (isImeKeydown(event)) return null;
  if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key))
    return null;
  const name = keyName(event);
  if (capture.mode === "some") return capture.keys.includes(name) ? name : null;
  // The app's shortcuts stay its own unless named: ⌘ on a Mac, Ctrl elsewhere.
  const mod = isMacPlatform() ? event.metaKey : event.ctrlKey || event.metaKey;
  if (mod && !capture.keys.includes(name)) return null;
  return name;
}

/** Whether a plugin holds this key in the focused editor, so the window's
 *  shortcuts leave it alone (Emacs's C-/ is undo, not Toggle Source Mode). */
export function heldByPlugin(event: KeyboardEvent): boolean {
  const view = held.view;
  if (!held.owner || !view || view.isDestroyed || !view.hasFocus())
    return false;
  return captures(event, held.owner.capture) !== null;
}

export const createEditorInputPlugin = () =>
  new Plugin<InputState>({
    key: inputKey,
    state: {
      init: () => ({ cursor: held.cursorStyle, labels: [], matches: [] }),
      apply(tr, prev) {
        const meta = tr.getMeta(inputKey) as Partial<InputState> | undefined;
        const next = meta ? { ...prev, ...meta } : prev;
        if (tr.docChanged && (next.labels.length || next.matches.length))
          return { ...next, ...NO_FLASH };
        return next;
      },
    },
    props: {
      handleKeyDown(view, event) {
        if (!held.owner) return false;
        const name = captures(event, held.owner.capture);
        if (!name) return false;
        held.view = view;
        held.owner.lastKeyAt = Date.now();
        held.owner.deliver(name);
        return true;
      },
      handleDOMEvents: {
        focus(view) {
          held.view = view;
          setCursorStyle(held.cursorStyle);
          // WebKit lets every input source in again as an element takes
          // the focus: after it has.
          setTimeout(() => syncRomanInput(true), 50);
          return false;
        },
        blur() {
          // After the blur, when the focus has gone.
          setTimeout(syncRomanInput);
          return false;
        },
      },
      attributes(state): Record<string, string> {
        const s = inputKey.getState(state);
        return s?.cursor === "block" ? { class: "plugin-cursor-block" } : {};
      },
      decorations(state) {
        const s = inputKey.getState(state);
        if (!s) return null;
        const decos: Decoration[] = [];
        const { selection, doc } = state;
        if (s.cursor === "block" && selection.empty) {
          const at = selection.head;
          const next =
            at < doc.content.size
              ? doc.textBetween(at, at + 1, "\n", "\n")
              : "";
          if (next && next !== "\n")
            decos.push(
              Decoration.inline(at, at + 1, { class: "plugin-block-cursor" }),
            );
          else
            decos.push(
              Decoration.widget(
                at,
                () => {
                  const span = document.createElement("span");
                  span.className =
                    "plugin-block-cursor plugin-block-cursor-empty";
                  span.textContent = " ";
                  return span;
                },
                { side: 1, key: "plugin-block-cursor" },
              ),
            );
        }
        for (const { from, to } of s.matches)
          decos.push(
            Decoration.inline(from, to, { class: "plugin-flash-match" }),
          );
        // A label goes over the character after its match, so the match stays readable.
        for (const { pos, label } of s.labels)
          decos.push(
            Decoration.widget(
              pos,
              () => {
                const anchor = document.createElement("span");
                anchor.className = "plugin-flash-anchor";
                const span = document.createElement("span");
                span.className = "plugin-flash-label";
                span.textContent = label;
                anchor.append(span);
                return anchor;
              },
              { side: -1, key: `flash-${pos}-${label}` },
            ),
          );
        return decos.length ? DecorationSet.create(doc, decos) : null;
      },
    },
    view(view) {
      held.view = view;
      return {
        destroy() {
          if (held.view === view) held.view = null;
        },
      };
    },
  });

export const editorInputPlugin = $prose(createEditorInputPlugin);
