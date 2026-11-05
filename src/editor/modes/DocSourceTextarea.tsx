import type { ComponentProps } from "react";
import { SourceTextarea } from "./SourceTextarea";
import { useSourceImagePaste } from "./useSourceImagePaste";

/** A document's source: a pasted picture is stored beside the file
 *  (`docPath`, null while unsaved) and written as Markdown. */
export function DocSourceTextarea({
  docPath,
  ...props
}: ComponentProps<typeof SourceTextarea> & { docPath: string | null }) {
  const images = useSourceImagePaste(docPath);
  return (
    <>
      <SourceTextarea {...props} onPaste={images.onPaste} />
      {images.dialog}
    </>
  );
}
