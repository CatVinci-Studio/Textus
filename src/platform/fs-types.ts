export interface DirEntryInfo {
  name: string;
  path: string;
  is_dir: boolean;
  /** Last modified (ms since the epoch), for the tree's sort by date; null
   *  or absent where the backend doesn't say (the iPhone's Files). */
  modified_ms?: number | null;
}
