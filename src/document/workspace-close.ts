/** Composition registers document work here; app close logic need not import AI. */
type CloseReason = "close" | "handoff";
const guards = new Map<string, (reason: CloseReason) => Promise<boolean>>();
export function registerWorkspaceClose(
  tabId: string,
  guard: (reason: CloseReason) => Promise<boolean>,
) {
  guards.set(tabId, guard);
  return () => {
    if (guards.get(tabId) === guard) guards.delete(tabId);
  };
}
export async function confirmWorkspaceClose(
  tabIds: string[],
  reason: CloseReason = "close",
): Promise<boolean> {
  for (const id of tabIds)
    if ((await guards.get(id)?.(reason)) === false) return false;
  return true;
}
