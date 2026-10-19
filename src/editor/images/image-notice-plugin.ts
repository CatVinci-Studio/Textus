import { Plugin } from "@milkdown/kit/prose/state";
import type { Slice } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { imageFilesFromClipboard } from "./pasted-files";

/** Whether a paste carries an image the desktop app would have stored: an
 *  image file or bitmap, image files copied in a file manager, or a bitmap
 *  that arrived as HTML with a `blob:` src. */
export function pastesImage(
  data: Pick<DataTransfer, "files" | "getData"> & {
    items?: ArrayLike<Pick<DataTransferItem, "kind" | "type">>;
  },
  slice: Slice | null,
): boolean {
  const items = Array.from(data.items ?? []);
  if (items.some((i) => i.kind === "file" && i.type.startsWith("image/")))
    return true;
  if (Array.from(data.files ?? []).some((f) => f.type.startsWith("image/")))
    return true;
  const copiedFiles = imageFilesFromClipboard({
    uriList: data.getData("text/uri-list"),
    gnomeCopiedFiles: data.getData("x-special/gnome-copied-files"),
  });
  if (copiedFiles.length > 0) return true;
  let blob = false;
  slice?.content.descendants((node) => {
    if (node.type.name === "image" && /^blob:/i.test(node.attrs.src ?? ""))
      blob = true;
    return !blob;
  });
  return blob;
}

/**
 * Stands in for the image store (editor/images/image-plugin.ts) where a
 * pasted image has nowhere to go: the browser playground, which has no
 * disk, and the Quick Note window, whose note has no folder for images
 * until it is saved. The paste inserts nothing and `onImage` says why.
 * Image files dropped on the playground never reach the editor - it takes
 * every file drop itself.
 */
export function createImageNoticePlugin(onImage: () => void) {
  return $prose(
    () =>
      new Plugin({
        props: {
          handlePaste(_view, event, slice) {
            if (
              !event.clipboardData ||
              !pastesImage(event.clipboardData, slice)
            )
              return false;
            onImage();
            return true;
          },
        },
      }),
  );
}
