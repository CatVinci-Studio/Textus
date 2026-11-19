import { blobToBase64 } from "../utils/blob-base64";
import { DROP_IMAGE_FILES_EVENT, sendAppEvent } from "../utils/events";
import { fs } from "../platform/ipc";
import { nativeFiles } from "../platform/native-files";
import { documentsDir } from "../platform/documents-path";
import { joinPath } from "../utils/path";
import { freeName, sortDroppedPaths } from "./dropped-files";

/**
 * Files dragged in from another app on an iPad: an HTML5 drop of their
 * contents, with no paths. Pictures go into the document where they land,
 * as on a computer; a document is copied into the app's own folder (On My
 * iPad › Textus), the way a file dragged into an iOS app is taken in, and
 * opened from there.
 */
export function watchFilesFromApps(
  openPathInTab: (path: string) => Promise<void>,
): () => void {
  const carriesFiles = (e: DragEvent) =>
    e.dataTransfer?.types.includes("Files") ?? false;
  const over = (e: DragEvent) => {
    if (carriesFiles(e)) e.preventDefault();
  };
  const drop = (e: DragEvent) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!carriesFiles(e) || !files.length) return;
    e.preventDefault();
    e.stopPropagation();
    void takeIn(files, { x: e.clientX, y: e.clientY }, openPathInTab);
  };
  window.addEventListener("dragover", over, true);
  window.addEventListener("drop", drop, true);
  return () => {
    window.removeEventListener("dragover", over, true);
    window.removeEventListener("drop", drop, true);
  };
}

async function takeIn(
  files: File[],
  point: { x: number; y: number },
  openPathInTab: (path: string) => Promise<void>,
) {
  const byName = new Map(files.map((file) => [file.name, file]));
  const { documents, images } = sortDroppedPaths([...byName.keys()]);
  if (images.length) {
    const paths = await Promise.all(
      images.map(async (name) => {
        const path = await nativeFiles.scratchPath(name);
        await fs.writeBase64File(path, await blobToBase64(byName.get(name)!));
        return path;
      }),
    );
    sendAppEvent(DROP_IMAGE_FILES_EVENT, { paths, point });
  }
  if (!documents.length) return;
  const folder = (await documentsDir()).replace(/\/+$/, "");
  const taken = new Set(
    (await fs.listDir(folder).catch(() => [])).map((e) => e.name),
  );
  for (const name of documents) {
    const free = freeName(name, taken);
    taken.add(free);
    const path = joinPath(folder, free);
    await fs.writeBase64File(path, await blobToBase64(byName.get(name)!));
    await openPathInTab(path);
  }
}
