/** The edits one block of a document takes - Textus AI's proposals and a
 *  plugin's edits alike. Keep in step with the
 *  backend's EDIT_ACTIONS, which validates proposals against it. */
export type EditAction =
  | "replace"
  | "replace_selection"
  | "insert_before"
  | "insert_after"
  | "delete"
  | "append"
  | "insert_at_cursor";

export const EDIT_ACTIONS: readonly EditAction[] = [
  "replace",
  "replace_selection",
  "insert_before",
  "insert_after",
  "delete",
  "append",
  "insert_at_cursor",
];
