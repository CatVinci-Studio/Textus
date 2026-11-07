import { useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { SourceEditor, type SourceEditorProps } from "./SourceEditor";
import { useSourceImagePaste } from "./useSourceImagePaste";

/** A document's source: a pasted picture is stored beside the file
 *  (`docPath`, null while unsaved) and written as Markdown, as a paste in the
 *  rich editor is. */
export function DocSourceEditor({
  docPath,
  ...props
}: SourceEditorProps & { docPath: string | null }) {
  const viewRef = useRef<EditorView | null>(null);
  const images = useSourceImagePaste(
    docPath,
    (markdown) => {
      const view = viewRef.current;
      // A tab switched while the picture was being stored: nowhere to put it.
      if (!view || !view.dom.isConnected) return;
      view.dispatch(view.state.replaceSelection(markdown), {
        scrollIntoView: true,
      });
      view.focus();
    },
    { readOnly: props.readOnly },
  );
  return (
    <>
      <SourceEditor
        {...props}
        onPaste={(event, view) => {
          viewRef.current = view;
          return images.onPaste(event);
        }}
      />
      {images.dialog}
    </>
  );
}
