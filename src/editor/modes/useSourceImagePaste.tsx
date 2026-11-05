import type { ClipboardEvent } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import { Presence } from "../../ui/usePresence";
import { useLatest } from "../../utils/hooks/useLatest";
import { ImageNameDialog } from "../images/ImageNameDialog";
import {
  clipboardImages,
  reportFailure,
  storeImage,
  type ImageStore,
} from "../images/image-store";
import { useImageNameRequest } from "../images/useImageNameRequest";

/** `![](src)`, the src in angle brackets where it has a space or a bracket. */
export function imageMarkdown(src: string): string {
  return /[\s()<>]/.test(src) ? `![](<${src}>)` : `![](${src})`;
}

/** Writes `text` at the caret of `el` as typing would, so Undo takes it back. */
function insertAtCaret(el: HTMLTextAreaElement, text: string) {
  el.focus();
  if (document.execCommand?.("insertText", false, text)) return;
  el.setRangeText(text, el.selectionStart, el.selectionEnd, "end");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Pictures pasted into source mode, stored as a paste in the rich editor
 * stores them (Settings › Images) and written as `![](src)` at the caret.
 */
export function useSourceImagePaste(docPath: string | null) {
  const { settings, t } = useSettings();
  const { imageNameRequest, requestImageName, closeImageNameDialog } =
    useImageNameRequest();
  const latest = useLatest({ docPath, settings, t });
  const store: ImageStore = {
    docPath: () => latest.current.docPath,
    settings: () => latest.current.settings,
    requestName: requestImageName,
    onError: () => latest.current.t.imageSaveFailed,
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.currentTarget.readOnly) return;
    const images = clipboardImages(event.clipboardData);
    if (images.length === 0) return;
    event.preventDefault();
    const el = event.currentTarget;
    void (async () => {
      for (const image of images) {
        try {
          const src = await storeImage(image, store);
          if (src !== null) insertAtCaret(el, imageMarkdown(src));
        } catch (err) {
          reportFailure(err, store);
        }
      }
    })();
  };

  const dialog = (
    <Presence show={!!imageNameRequest} exitMs={120}>
      {imageNameRequest && (
        <ImageNameDialog
          request={imageNameRequest}
          title={t.imageNameDialogTitle}
          label={t.imageNameDialogLabel}
          invalidLabel={t.imageNameDialogInvalid}
          uploadLabel={t.imageNameDialogUpload}
          cancelLabel={t.closePromptCancel}
          onClose={closeImageNameDialog}
        />
      )}
    </Presence>
  );
  return { onPaste, dialog };
}
