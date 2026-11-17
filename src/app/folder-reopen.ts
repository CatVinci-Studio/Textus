/**
 * Brings a folder's documents back one by one as it opens in this window;
 * a folder opened after it stops what is left of its documents, which
 * would otherwise land in the newer folder's workspace.
 */
export function folderReopener(
  documentsOf: (folder: string) => Promise<string[]>,
  open: (path: string) => Promise<void>,
): (folder: string) => Promise<void> {
  let turn = 0;
  return async (folder) => {
    const mine = ++turn;
    const docs = await documentsOf(folder);
    for (const doc of docs) {
      if (mine !== turn) return;
      await open(doc);
    }
  };
}
