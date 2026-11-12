/**
 * Keys for the area's islands that follow their tabs: an island keeps the
 * key of the one most of its tabs were in, so a split, a merge or a pane
 * renamed moves the same element (a slide) instead of making a new one.
 * `before` maps each tab to its island's key last time; returns the keys
 * in `groups`' order and the map for next time.
 */
export function islandKeys(
  groups: { id: string; tabs: readonly string[] }[],
  before: ReadonlyMap<string, string>,
): { keys: string[]; byTab: Map<string, string> } {
  const votes = groups.flatMap((group, at) => {
    const count = new Map<string, number>();
    for (const tab of group.tabs) {
      const key = before.get(tab);
      if (key) count.set(key, (count.get(key) ?? 0) + 1);
    }
    return [...count].map(([key, n]) => ({ at, key, n }));
  });
  const keys: (string | undefined)[] = groups.map(() => undefined);
  const taken = new Set<string>();
  for (const { at, key } of votes.sort((a, b) => b.n - a.n))
    if (!keys[at] && !taken.has(key)) {
      keys[at] = key;
      taken.add(key);
    }
  const done = groups.map((group, at) => {
    let key = keys[at] ?? `island:${group.id}`;
    // A new pane named as an island kept elsewhere.
    for (let n = 2; taken.has(key) && !keys[at]; n++)
      key = `island:${group.id}:${n}`;
    taken.add(key);
    return key;
  });
  const byTab = new Map<string, string>();
  groups.forEach((group, at) => {
    for (const tab of group.tabs) byTab.set(tab, done[at]!);
  });
  return { keys: done, byTab };
}
