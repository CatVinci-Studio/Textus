import RULES from "./edit-actions.json";

/** The edits one block of a document takes - Textus AI's proposals and a
 *  plugin's edits alike: one list with the backend's, which validates
 *  proposals against it (edit-actions.json; ai/tools/edits.rs reads it). */
export type EditAction =
  | "replace"
  | "replace_selection"
  | "insert_before"
  | "insert_after"
  | "delete"
  | "append"
  | "insert_at_cursor";

interface EditRule {
  action: EditAction;
  /** Found by words in the document (`anchor`); the others act on the
   *  selection, the caret or the end. */
  anchored: boolean;
  /** Carries the new text; a deletion doesn't. */
  text: boolean;
}

const EDIT_RULES = RULES as readonly EditRule[];

export const EDIT_ACTIONS: readonly EditAction[] = EDIT_RULES.map(
  (rule) => rule.action,
);

const ruleOf = (action: EditAction) =>
  EDIT_RULES.find((rule) => rule.action === action);

/** Whether `action` finds its place by an anchor in the document. */
export const needsAnchor = (action: EditAction): boolean =>
  ruleOf(action)?.anchored ?? true;

/** Whether `action` carries new text. */
export const needsText = (action: EditAction): boolean =>
  ruleOf(action)?.text ?? true;
