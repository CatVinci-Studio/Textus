import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { touch } from "./pointer-hold";
import { withEditorCore } from "./editor-extensions";
import { loadSettings, type Settings } from "../prefs/SettingsContext";

// Test-only: the editor on its own (withEditorCore) - no AI, no plugins'
// blocks - mounted in jsdom, for tests of its syntax, keys and saving.
// Callers destroy what they create. `settings` overrides the stored ones.
// Touched, as by a person, unless `untouched`: tests set the caret by hand.
export async function createTestEditor(
  markdown: string,
  settings: Partial<Settings> = {},
  docPath: string | null = null,
  { untouched = false } = {},
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
  if (!untouched) touch(editor.ctx.get(editorViewCtx));
  return editor;
}
