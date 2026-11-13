/** Where a description's first clause ends: its core, before the detail. */
/** A full-width stop, a Latin one closing a word before a space (not a
 *  time's 09:00, not a lone ":" shown as a key), or a dash set apart. */
const CLAUSE_END = /[：。；]|(?<=\S)[:;.](?=\s)|\s[-–—]\s/;

/** A plugin's description cut to its first clause, for a row's one line;
 *  the whole of it is on the plugin's page. */
export function pluginLead(description: string): string {
  const end = description.search(CLAUSE_END);
  return end > 0 ? description.slice(0, end).trim() : description.trim();
}
