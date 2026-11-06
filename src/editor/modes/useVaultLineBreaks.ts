import { useEffect, useState } from "react";
import { fs } from "../../platform/ipc";

/** Whether the document's folder shows a single newline as a line break
 *  (an Obsidian vault with "Strict line breaks" off, a Logseq graph, VS
 *  Code's preview setting). Read-only; false where no app says so, or
 *  before the answer comes. */
export function useVaultLineBreaks(docPath: string | null): boolean {
  const [found, setFound] = useState<{ path: string; breaks: boolean }>();
  useEffect(() => {
    if (!docPath) return;
    let current = true;
    fs.folderConventions(docPath).then(
      (c) =>
        current && setFound({ path: docPath, breaks: !!c.softBreaks?.value }),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [docPath]);
  return found?.path === docPath && found.breaks;
}
