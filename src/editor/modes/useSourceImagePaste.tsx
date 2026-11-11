import { useSettings } from "../../prefs/SettingsContext";
import { Presence } from "../../engine/motion/usePresence";
import { useLatest } from "../../utils/hooks/useLatest";
import { ImageNameDialog } from "../images/ImageNameDialog";
import type { ImageStore } from "../images/image-store";
import { clipboardImageSources } from "../images/pasted-files";
import { useImageNameRequest } from "../images/useImageNameRequest";

/** `![](src)`, the src in angle brackets where it has a space or a bracket. */
export function imageMarkdown(src: string): string {
  return /[\s()<>]/.test(src) ? `![](<${src}>)` : `![](${src})`;
}

/** Where a stored picture's `![](src)` goes: the source editor's caret. */
type InsertImageMarkdown = (markdown: string) => void;

/** What a paste event has to offer, as React's and the DOM's both do. */
interface PasteEvent {
  clipboardData: DataTransfer | null;
  preventDefault: () => void;
}

/**
 * Pictures pasted into source mode, stored as a paste in the rich editor
 * stores them (Settings › Images) and written as `![](src)` at the caret.
 * Independent of the widget: the caller says how to write text, so CodeMirror
 * and a textarea share the storage, naming and error handling.
 */
export function useSourceImagePaste(
  docPath: string | null,
  insert: InsertImageMarkdown,
  { readOnly = false, enabled = true } = {},
) {
  const { settings, t } = useSettings();
  const { imageNameRequest, requestImageName, closeImageNameDialog } =
    useImageNameRequest();
  const latest = useLatest({ docPath, settings, t, insert, readOnly, enabled });
  const store: ImageStore = {
    docPath: () => latest.current.docPath,
    settings: () => latest.current.settings,
    requestName: requestImageName,
    onError: () => latest.current.t.imageSaveFailed,
  };

  /** Takes a paste that carries pictures; false leaves it to the editor. */
  const onPaste = (event: PasteEvent): boolean => {
    if (!latest.current.enabled || latest.current.readOnly) return false;
    // Read now: the clipboard is gone once the event is over.
    const sources = clipboardImageSources(event.clipboardData);
    if (sources.files.length + sources.paths.length === 0) return false;
    event.preventDefault();
    void (async () => {
      // Not at startup: the store brings the Markdown writer along.
      const { pastedImages, reportFailure, storeImageAs } =
        await import("../images/image-store");
      for (const image of pastedImages(sources)) {
        try {
          const stored = await storeImageAs(image, store);
          if (stored)
            latest.current.insert(stored.embed ?? imageMarkdown(stored.src));
        } catch (err) {
          reportFailure(err, store);
        }
      }
    })();
    return true;
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
