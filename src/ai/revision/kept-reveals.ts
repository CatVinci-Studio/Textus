/** The proposals whose reveal is kept for a document while its tab is open
 *  and its editor gone, by path: they come back drawn, not typed in again.
 *  Apart from the reveals themselves, so closing a tab needn't load them. */
const keptFor = new Map<string, Set<string>>();
let dropReveal: (callId: string) => void = () => {};

/** What `path`'s editor left undecided as it went; those kept before and
 *  not now go. */
export function keepReveals(
  path: string,
  callIds: string[],
  drop: (callId: string) => void,
) {
  dropReveal = drop;
  for (const callId of keptFor.get(path) ?? [])
    if (!callIds.includes(callId)) drop(callId);
  if (callIds.length > 0) keptFor.set(path, new Set(callIds));
  else keptFor.delete(path);
}

/** Its tab closed: what was kept for it goes. */
export function forgetReveals(path: string) {
  for (const callId of keptFor.get(path) ?? []) dropReveal(callId);
  keptFor.delete(path);
}
