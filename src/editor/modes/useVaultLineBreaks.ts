import { useEffect, useState } from "react";
import { fs } from "../../platform/ipc";

/** Whether the document's Obsidian vault shows a single newline as a line
 *  break (its "Strict line breaks" off, Obsidian's default). Read-only; false
 *  outside a vault or before the answer comes. */
export function useVaultLineBreaks(docPath: string | null): boolean {
  const [vault, setVault] = useState<{ path: string; breaks: boolean }>();
  useEffect(() => {
    if (!docPath) return;
    let current = true;
    fs.obsidianVault(docPath).then(
      (found) =>
        current &&
        setVault({ path: docPath, breaks: !!found && !found.strictLineBreaks }),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [docPath]);
  return vault?.path === docPath && vault.breaks;
}
