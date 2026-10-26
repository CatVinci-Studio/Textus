import { useEffect } from "react";
import { useLatest } from "../../utils/hooks/useLatest";
import type { EditorRunner } from "../useEditorRunner";
import {
  applyEditorCaret,
  readEditorCaret,
  registerCaretReporter,
  takePendingCaret,
} from "./mode-switch";

/** Source/WYSIWYG switches keep the caret: on screen this editor reports its
 *  caret, and on mounting it takes the caret the source view left. */
export function useModeSwitchCaret(
  run: EditorRunner,
  isActive: boolean,
  initialValue: string,
) {
  useEffect(() => {
    if (!isActive) return;
    return registerCaretReporter(
      (markdown) => run((ctx) => readEditorCaret(ctx, markdown)) ?? null,
    );
  }, [isActive, run]);
  const runReady = run(() => true) === true;
  // Once per mount: the caret is handed across a single switch, against the
  // text the editor mounted with.
  const mounted = useLatest({ run, initialValue });
  useEffect(() => {
    if (!isActive || !runReady) return;
    const caret = takePendingCaret();
    if (!caret) return;
    const { run, initialValue } = mounted.current;
    // After layout, so coordinates for the scroll correction exist.
    requestAnimationFrame(() =>
      run((ctx) => applyEditorCaret(ctx, initialValue, caret)),
    );
  }, [isActive, runReady, mounted]);
}
