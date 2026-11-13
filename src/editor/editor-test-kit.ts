import { Editor, defaultValueCtx, rootCtx } from "@milkdown/kit/core";
import { withEditorCore } from "./editor-extensions";
import { loadSettings, type Settings } from "../prefs/SettingsContext";

// Test-only: the editor on its own (withEditorCore) - no AI, no plugins'
// blocks - mounted in jsdom, for tests of its syntax, keys and saving.
// Callers destroy what they create. `settings` overrides the stored ones.
export async function createTestEditor(
  markdown: string,
  settings: Partial<Settings> = {},
  docPath: string | null = null,
): Promise<Editor> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = withEditorCore(
    Editor.make().config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    }),
    {
      settings: { current: { ...loadSettings(), ...settings } },
      docPath: { current: docPath },
      onImagePasteError: () => "",
      requestImageName: async () => null,
    },
  );
  await editor.create();
  return editor;
}
