/** `items` with those `keys` names put back in its order, in the places
 *  they took; the others stay where they are. The same array when nothing
 *  moves. */
export function inOrder<T>(
  items: T[],
  keyOf: (item: T) => string,
  keys: readonly string[],
): T[] {
  const rank = new Map(keys.map((k, i) => [k, i]));
  const rankOf = (item: T) => rank.get(keyOf(item)) ?? -1;
  const sorted = items
    .filter((item) => rankOf(item) >= 0)
    .sort((a, b) => rankOf(a) - rankOf(b));
  let next = 0;
  const out = items.map((item) => (rankOf(item) >= 0 ? sorted[next++]! : item));
  return out.every((item, i) => item === items[i]) ? items : out;
}
