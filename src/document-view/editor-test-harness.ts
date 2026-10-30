import { Editor, defaultValueCtx, rootCtx } from "@milkdown/kit/core";
import { withEditorExtensions } from "./editor-extensions";
import { loadSettings, type Settings } from "../prefs/SettingsContext";

// Test-only: the full editor chain MilkdownEditor builds, mounted in jsdom
// with no-op callbacks, for tests that need real parsing and serializing.
// Callers destroy what they create. `settings` overrides the stored ones;
// the AI features stay quiet unless `ai` is set.
export async function createTestEditor(
  markdown: string,
  settings: Partial<Settings> = {},
  { ai = false }: { ai?: boolean } = {},
): Promise<Editor> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = withEditorExtensions(
    Editor.make().config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    }),
    { current: { ...loadSettings(), ...settings } },
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
    { current: ai ? null : "muted" },
    () => "",
    async () => null,
  );
  await editor.create();
  return editor;
}
