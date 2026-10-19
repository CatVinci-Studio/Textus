import { type RefObject, useEffect, useRef } from "react";
import { Editor, editorViewCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { listenerCtx } from "@milkdown/kit/plugin/listener";
import { getMarkdown, replaceAll } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import {
  configureEditorRoot,
  withEditorCore,
} from "../editor/editor-extensions";
import { useEditorRunner } from "../editor/useEditorRunner";
import { useModeSwitchCaret } from "../editor/modes/useModeSwitchCaret";
import type { Settings } from "../settings/SettingsContext";
import { useLatest } from "../utils/hooks/useLatest";
import { normalizeMathDelimiters } from "../utils/markdown-math";
import { createImageNoticePlugin } from "../editor/images/image-notice-plugin";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "katex/dist/katex.min.css";
import "../theme/content-base.css";
import "../editor/milkdown-theme.css";
import "../theme/content-themes.css";

/** What the page does to the document from outside the editor. */
export interface EditorHandle {
  /** The document now, including an edit the listener hasn't reported. */
  markdown: () => string | undefined;
  /** Reports an edit the listener's debounce still holds (the page is
   *  going away) - nothing when the document is as last reported. */
  flush: () => void;
  /** Replaces the document as one undoable step (an import). */
  replace: (markdown: string) => void;
}

interface Props {
  initialValue: string;
  /** Fixed for the page's life: the playground has no Settings panel. */
  settings: Settings;
  onChange: (markdown: string) => void;
  /** An image was pasted - there is nowhere to store it. */
  onImage: () => void;
  handleRef: RefObject<EditorHandle | null>;
}

/**
 * The app's Markdown editor - the same core plugin chain
 * (editor/editor-extensions.ts) without the AI on top and without the
 * parts that need a disk: a pasted image gets a notice instead, and no
 * clipboard history is kept.
 */
function MarkdownEditor({
  initialValue,
  settings,
  onChange,
  onImage,
  handleRef,
}: Props) {
  const onChangeRef = useLatest(onChange);
  const onImageRef = useLatest(onImage);
  const settingsRef = useLatest(settings);
  // The doc last handed to onChange, or the one it opened with.
  const reportedDocRef = useRef<ProseNode | null>(null);

  useEditor(
    (root) =>
      withEditorCore(
        Editor.make().config((ctx) => {
          configureEditorRoot(ctx, root, initialValue);
          ctx
            .get(listenerCtx)
            .mounted((ctx) => {
              reportedDocRef.current = ctx.get(editorViewCtx).state.doc;
            })
            .updated((_ctx, doc) => {
              reportedDocRef.current = doc;
            })
            .markdownUpdated((_ctx, markdown) => onChangeRef.current(markdown));
        }),
        {
          settings: settingsRef,
          docPath: { current: null },
          noDiskImages: createImageNoticePlugin(() => onImageRef.current()),
        },
      ),
    [],
  );

  const run = useEditorRunner();
  // Keeps the caret in place across a switch to and from source mode.
  useModeSwitchCaret(run, true, initialValue);
  useEffect(() => {
    handleRef.current = {
      markdown: () => run(getMarkdown()),
      flush: () =>
        run((ctx) => {
          const { doc } = ctx.get(editorViewCtx).state;
          if (!reportedDocRef.current || doc.eq(reportedDocRef.current)) return;
          reportedDocRef.current = doc;
          onChangeRef.current(getMarkdown()(ctx));
        }),
      replace: (markdown) => run(replaceAll(normalizeMathDelimiters(markdown))),
    };
    return () => {
      handleRef.current = null;
    };
  }, [run, handleRef, onChangeRef]);

  return <Milkdown />;
}

export function PlaygroundEditor(props: Props) {
  return (
    <div className="editor-scroll">
      <div className="editor-content">
        <MilkdownProvider>
          <MarkdownEditor {...props} />
        </MilkdownProvider>
      </div>
    </div>
  );
}
