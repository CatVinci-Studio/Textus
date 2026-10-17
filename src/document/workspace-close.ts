/** Composition registers document work here; app close logic need not import AI. */
const guards = new Map<string, () => Promise<boolean>>();
export function registerWorkspaceClose(
  tabId: string,
  guard: () => Promise<boolean>,
) {
  guards.set(tabId, guard);
  return () => {
    if (guards.get(tabId) === guard) guards.delete(tabId);
  };
}
export async function confirmWorkspaceClose(
  tabIds: string[],
): Promise<boolean> {
  for (const id of tabIds)
    if ((await guards.get(id)?.()) === false) return false;
  return true;
}
