import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import {
  generatedImageRatio,
  generatedImageUrl,
  loadGeneratedImage,
  onPictureSettled,
  shownImageFailure,
} from "./generated-images";
import { sheenPhase } from "./pending-picture";

/** Picture `id` as it stands, read again whenever a picture comes or goes:
 *  its address once made, or why it wasn't. Asked for on mount. */
export function useGeneratedPicture(id: string | null): {
  url: string | null;
  failure: string | null;
} {
  const url = useSyncExternalStore(onPictureSettled, () =>
    id ? generatedImageUrl(id) : null,
  );
  const failure = useSyncExternalStore(onPictureSettled, () =>
    id ? (shownImageFailure(id) ?? null) : null,
  );
  useEffect(() => {
    if (id && !url && !failure) void loadGeneratedImage(id);
  }, [id, url, failure]);
  return { url: url ?? null, failure };
}

/** A picture's frame while it is made, on a card: the document's frame
 *  (pending-picture.ts), its sheen in step with the document's. */
export function PictureFrame({
  id,
  alt,
  className,
}: {
  id: string;
  alt: string;
  className: string;
}) {
  const style = {
    aspectRatio: generatedImageRatio(id),
    "--pending-picture-phase": sheenPhase(),
  } as CSSProperties;
  return (
    <span
      className={`pending-picture ${className}`}
      role="img"
      aria-busy="true"
      aria-label={alt}
      style={style}
    >
      <span className="pending-picture-blob" />
      <span className="pending-picture-blob" />
      <span className="pending-picture-blob" />
    </span>
  );
}
