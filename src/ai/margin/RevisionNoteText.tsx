import { useSyncExternalStore } from "react";
import {
  generatedImageFailure,
  generatedImageId,
  generatedImageRatio,
  generatedImageUrl,
  onPictureSettled,
} from "../revision/generated-images";
import { usePicturesState } from "../revision/usePicturesState";
import { PICTURES_IN_TEXT } from "../revision/markdown-forms";

/**
 * A revision card's text (ReviewMargin): its words as they are, and each
 * picture in it as the picture, small - not its Markdown, which the user
 * never sees anywhere else. A picture being made is its frame until it
 * comes; one already in the document is the one drawn there.
 */
export function RevisionNoteText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(PICTURES_IN_TEXT)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const src = match[2].startsWith("<") ? match[2].slice(1, -1) : match[2];
    parts.push(<NotePicture key={at} src={src} alt={match[1]} />);
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

const subscribe = (listener: () => void) => {
  const stop = onPictureSettled(listener);
  return () => {
    stop();
  };
};

function NotePicture({ src, alt }: { src: string; alt: string }) {
  const id = generatedImageId(src);
  // Asked for, so it comes whether or not its frame is on screen.
  usePicturesState(id ? `![](${src})` : "");
  const made = useSyncExternalStore(subscribe, () =>
    id ? generatedImageUrl(id) : null,
  );
  if (id) {
    if (made)
      return <img className="revision-note-picture" src={made} alt={alt} />;
    const why = generatedImageFailure(id);
    if (why) return <span className="revision-note-picture-why">{why}</span>;
    return (
      <span
        className="pending-picture revision-note-picture-frame"
        role="img"
        aria-busy="true"
        aria-label={alt}
        style={{ aspectRatio: generatedImageRatio(id) }}
      >
        <span className="pending-picture-blob" />
        <span className="pending-picture-blob" />
        <span className="pending-picture-blob" />
      </span>
    );
  }
  // One in the document: drawn from where the document draws it (the
  // asset: URL its relative src resolves to), else as written.
  const shown = document
    .querySelector<HTMLImageElement>(
      `.ProseMirror img[data-doc-src="${CSS.escape(src)}"]`,
    )
    ?.getAttribute("src");
  return <img className="revision-note-picture" src={shown ?? src} alt={alt} />;
}
