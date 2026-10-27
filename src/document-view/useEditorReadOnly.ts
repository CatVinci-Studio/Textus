import { useEffect } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import { READ_ONLY_REFUSED, setReadOnly } from "../editor/read-only-plugin";

/** Keeps the editor read-only while its tab is, and says so when something
 *  tries to change it. */
export function useEditorReadOnly(
  run: EditorRunner,
  readOnly: boolean,
  onRefused: () => void,
): void {
  useEffect(() => {
    run((ctx) => setReadOnly(ctx.get(editorViewCtx), readOnly));
  }, [run, readOnly]);
  useEffect(() => {
    const dom = run((ctx) => ctx.get(editorViewCtx).dom);
    if (!dom) return;
    dom.addEventListener(READ_ONLY_REFUSED, onRefused);
    return () => dom.removeEventListener(READ_ONLY_REFUSED, onRefused);
  }, [run, onRefused]);
}
