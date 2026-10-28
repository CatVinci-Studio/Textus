import { isLinuxPlatform } from "../../platform/os";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isImeKeydown } from "../../utils/ime";

// WebKitGTK reports Apple's vendor, so prosemirror-view applies Safari's
// rule of dropping the first keydown within 500ms of a compositionend. Linux
// IMEs send consumed keys as keyCode 229, so the rule only swallows a real
// Enter; clearing the timestamp lets genuine keys through.
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
            if (isImeKeydown(event)) return false;
            // A private field, but the only one the rule reads; the value is what
            // prosemirror-view itself resets it to.
            const input = (view as ViewInput).input;
            if (input?.compositionEndedAt !== undefined)
              input.compositionEndedAt = -2e8;
            return false;
          },
        },
      },
    }),
);
