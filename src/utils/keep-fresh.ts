/** Puts `value` at the fresh end of `map`, the stalest let go past `max`:
 *  a cache bounded by how recently each entry was kept. */
export function keepFresh<K, V>(map: Map<K, V>, key: K, value: V, max: number) {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value as K);
}
