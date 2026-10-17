import { Editor, defaultValueCtx, rootCtx } from "@milkdown/kit/core";
import { withEditorExtensions } from "./editor-extensions";
import { loadSettings } from "../settings/SettingsContext";
import { normalizeMathDelimiters } from "../utils/markdown-math";

// Test-only: the full editor chain MilkdownEditor builds, mounted in jsdom
// with no-op callbacks, for tests that need real parsing and serializing.
// Callers destroy what they create.
export async function createTestEditor(markdown: string): Promise<Editor> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = withEditorExtensions(
    Editor.make().config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, normalizeMathDelimiters(markdown));
    }),
    { current: loadSettings() },
    { current: null },
    {
      onAccept() {},
      onReject() {},
      onPreviewsChange() {},
      getFocusedCallId: () => null,
      onDecide() {},
      getFocusedSentence: () => null,
    },
    { onMount() {}, onUnmount() {} },
    { current: "muted" },
    () => "",
    async () => null,
  );
  await editor.create();
  return editor;
}
