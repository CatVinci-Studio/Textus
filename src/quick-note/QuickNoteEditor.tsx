import { type RefObject, useEffect, useRef } from "react";
import { Editor, editorViewCtx } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { listenerCtx } from "@milkdown/kit/plugin/listener";
import { getMarkdown } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import {
  configureEditorRoot,
  withEditorCore,
} from "../editor/editor-extensions";
import { useEditorRunner } from "../editor/useEditorRunner";
import { createImageNoticePlugin } from "../editor/images/image-notice-plugin";
import { FindReplaceBar } from "../editor/find/FindReplaceBar";
import { useFindReplace } from "../editor/find/useFindReplace";
import { Presence } from "../ui/usePresence";
import type { Settings } from "../settings/SettingsContext";
import type { Strings } from "../i18n/strings";
import { useLatest } from "../utils/hooks/useLatest";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "katex/dist/katex.min.css";
import "../theme/content-base.css";
import "../editor/milkdown-theme.css";
import "../theme/content-themes.css";

/** What the window does to the note from outside the editor. */
export interface QuickNoteEditorHandle {
  /** The note now, including an edit the listener hasn't reported. */
  markdown: () => string | undefined;
  toggleFind: () => void;
  findOpen: () => boolean;
}

interface Props {
  initialValue: string;
  settings: Settings;
  t: Strings;
  onChange: (markdown: string) => void;
  /** The editor is on screen with the caret in it: typing can start. */
  onReady: () => void;
  /** An image was pasted - a quick note has nowhere to keep one. */
  onImage: () => void;
  handleRef: RefObject<QuickNoteEditorHandle | null>;
}

/**
 * The app's Markdown editor with nothing on top: the core plugin chain
 * (editor/editor-extensions.ts) and its find bar, as the browser playground
 * has it (src/playground/PlaygroundEditor.tsx) - no AI, no clipboard
 * history, no image store. Light, because the window has to take typing
 * within moments of the shortcut.
 */
function NoteEditor({
  initialValue,
  settings,
  t,
  onChange,
  onReady,
  onImage,
  handleRef,
}: Props) {
  const onChangeRef = useLatest(onChange);
  const onReadyRef = useLatest(onReady);
  const onImageRef = useLatest(onImage);
  const settingsRef = useLatest(settings);
  const reportedDocRef = useRef<ProseNode | null>(null);

  useEditor(
    (root) =>
      withEditorCore(
        Editor.make().config((ctx) => {
          configureEditorRoot(ctx, root, initialValue);
          ctx
            .get(listenerCtx)
            .mounted((ctx) => {
              const view = ctx.get(editorViewCtx);
              reportedDocRef.current = view.state.doc;
              // At the end of what is there: a continued note goes on.
              view.dispatch(
                view.state.tr.setSelection(Selection.atEnd(view.state.doc)),
              );
              view.focus();
              onReadyRef.current();
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
  const findReplace = useFindReplace(run);
  const findOpenRef = useLatest(findReplace.open);
  const toggleFind = findReplace.toggle;
  useEffect(() => {
    handleRef.current = {
      markdown: () => run(getMarkdown()),
      toggleFind,
      findOpen: () => findOpenRef.current,
    };
    return () => {
      handleRef.current = null;
    };
  }, [run, handleRef, toggleFind, findOpenRef]);

  return (
    <>
      <Milkdown />
      <Presence show={findReplace.open} exitMs={120}>
        {findReplace.open && (
          <FindReplaceBar findReplace={findReplace} labels={t} />
        )}
      </Presence>
    </>
  );
}

export function QuickNoteEditor(props: Props) {
  return (
    <div className="quick-note-scroll">
      <div className="quick-note-content">
        <MilkdownProvider>
          <NoteEditor {...props} />
        </MilkdownProvider>
      </div>
    </div>
  );
}
