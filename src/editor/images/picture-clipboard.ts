import { NodeSelection, Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** The picture selected in `view` as PNG, so other apps paste the picture
 *  rather than its Markdown; null when no picture is selected. */
export function selectedPictureAsPng(view: EditorView): Promise<Blob> | null {
  const { selection } = view.state;
  if (
    !(selection instanceof NodeSelection) ||
    selection.node.type.name !== "image"
  )
    return null;
  const dom = view.nodeDOM(selection.from);
  const img =
    dom instanceof HTMLImageElement
      ? dom
      : dom instanceof HTMLElement
        ? dom.querySelector("img")
        : null;
  const src = img?.currentSrc || img?.src;
  if (!src) return null;
  return fetch(src)
    .then((response) => response.blob())
    .then(asPng);
}

/** The clipboard takes pictures only as PNG. */
async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (png) => (png ? resolve(png) : reject(new Error("no PNG"))),
      "image/png",
    ),
  );
}

/** Writes the HTML and the plain text, with the picture when there is one;
 *  a picture that can't be read is left out, and a webview without
 *  ClipboardItem gets the plain text alone. */
export async function writeClipboard(
  html: string,
  text: string,
  png: Promise<Blob> | null,
): Promise<void> {
  const parts = {
    "text/html": new Blob([html], { type: "text/html" }),
    "text/plain": new Blob([text], { type: "text/plain" }),
  };
  const tries = png ? [{ ...parts, "image/png": png }, parts] : [parts];
  for (const item of tries) {
    try {
      await navigator.clipboard.write([new ClipboardItem(item)]);
      return;
    } catch {
      // The next, plainer try.
    }
  }
  await navigator.clipboard.writeText(text);
}

/** Cmd+C on a selected picture: after the usual copy, the picture joins
 *  it. */
export const pictureCopyPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          copy(view) {
            const png = selectedPictureAsPng(view);
            if (!png) return false;
            const { dom, text } = view.serializeForClipboard(
              view.state.selection.content(),
            );
            void writeClipboard(dom.innerHTML, text, png);
            return false;
          },
        },
      },
    }),
);
