import { fs } from "../../platform/ipc";
import { imageLocation } from "./missing-image";

/** Each picture's size, by document and src: known once it has loaded, or
 *  read ahead from its file's header. Drawn, a picture takes its room before
 *  it loads, so nothing below it moves when it arrives. */
const sizes = new Map<string, { width: number; height: number }>();

function setRoom(
  img: HTMLImageElement,
  size: { width: number; height: number },
) {
  img.width = size.width;
  img.height = size.height;
}

/** `img`, the picture `src` in `doc` (`key`), given its room: the size known
 *  already, or else the one its file says, unless it has loaded or another
 *  picture is wanted by then. */
export function reserveRoom(
  img: HTMLImageElement,
  key: string,
  src: string,
  doc: string | null,
  stillWanted: () => boolean,
): void {
  const known = sizes.get(key);
  if (known) return setRoom(img, known);
  img.removeAttribute("width");
  img.removeAttribute("height");
  const location = imageLocation(src, doc);
  if (location.kind !== "local") return;
  void fs
    .pictureSize(location.path)
    .then((read) => {
      if (!read || !stillWanted() || img.naturalWidth) return;
      sizes.set(key, read);
      setRoom(img, read);
    })
    .catch(() => {});
}

/** The size `img` loaded at, for the next time it is drawn. */
export function rememberSize(key: string, img: HTMLImageElement): void {
  if (img.naturalWidth)
    sizes.set(key, { width: img.naturalWidth, height: img.naturalHeight });
}
