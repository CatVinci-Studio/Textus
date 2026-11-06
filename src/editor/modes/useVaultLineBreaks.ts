import { useEffect, useState } from "react";
import { fs } from "../../platform/ipc";

/** Whether the document's project shows a single newline as a line break,
 *  as its .textus/settings.json says; false otherwise, or before the
 *  answer comes. */
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
