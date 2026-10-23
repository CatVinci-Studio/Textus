import { isLinuxPlatform } from "../../platform/os";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

// WebKitGTK reports navigator.vendor "Apple Computer, Inc.", so
// prosemirror-view treats it as Safari and applies Safari's IME rule: the
// first keydown within 500ms of a compositionend is dropped, because
// macOS's Japanese IME confirms with Enter and the page sees that Enter as
// a keydown too. Linux IMEs (fcitx5, ibus) mostly commit with Space or a
// digit, and any key they do consume reaches the page as keyCode 229 - so
// there the rule only swallows the user's real Enter right after picking a
// candidate, which then has to be pressed twice. Clearing the timestamp
// before prosemirror-view's own keydown handler reads it keeps the rule
// for IME-processed keys and lets genuine keystrokes through.
const isLinuxWebKit = isLinuxPlatform();

interface ViewInput {
  input?: { compositionEndedAt?: number };
}

export const linuxImeEnterPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          keydown(view: EditorView, event: KeyboardEvent) {
            if (!isLinuxWebKit || view.composing) return false;
            if (event.isComposing || event.keyCode === 229) return false;
            // A private field, but the only one the rule consults; the
            // value is what prosemirror-view itself resets it to.
            const input = (view as ViewInput).input;
            if (input?.compositionEndedAt !== undefined)
              input.compositionEndedAt = -2e8;
            return false;
          },
        },
      },
    }),
);
