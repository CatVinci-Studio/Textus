import { useLayoutEffect, useRef } from "react";
import { generatedImageId } from "../revision/generated-images";
import { PictureFrame, useGeneratedPicture } from "../revision/PictureFrame";
import { usePicturesState } from "../revision/usePicturesState";
import { PICTURES_IN_TEXT } from "../revision/markdown-forms";

/** A revision card's text, each picture shown small rather than as its
 *  Markdown. A picture being made shows its frame until it comes. */
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

function NotePicture({ src, alt }: { src: string; alt: string }) {
  const id = generatedImageId(src);
  // Asked for, so it comes whether or not its frame is on screen.
  usePicturesState(id ? `![](${src})` : "");
  const { url: made, failure: why } = useGeneratedPicture(id);
  // One in the document: drawn from where its own document draws it (the
  // asset: URL its relative src resolves to), else as written.
  const own = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const img = own.current;
    const shown = img
      ?.closest("[data-tab-id]")
      ?.querySelector<HTMLImageElement>(
        `.ProseMirror img[data-doc-src="${CSS.escape(src)}"]`,
      )
      ?.getAttribute("src");
    if (img && shown) img.src = shown;
  }, [src]);
  if (id) {
    if (made)
      return <img className="revision-note-picture" src={made} alt={alt} />;
    if (why) return <span className="revision-note-picture-why">{why}</span>;
    return (
      <PictureFrame id={id} alt={alt} className="revision-note-picture-frame" />
    );
  }
  return (
    <img ref={own} className="revision-note-picture" src={src} alt={alt} />
  );
}
