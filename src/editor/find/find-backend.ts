import type { FindMeta, FindReplaceMatch, FindState } from "./find-query";

/**
 * The editor a find bar works on: the rich document (ProseMirror) or its
 * source (CodeMirror). The bar, its keys and its words are one; only these
 * steps differ.
 */
export interface FindBackend {
  /** A search step taken; the search after it. */
  apply(meta: FindMeta): FindState;
  state(): FindState;
  /** `edits` written as one undo step, as in Word. */
  replace(edits: readonly { from: number; to: number; text: string }[]): void;
  /** The highlights gone, `select` selected; focus back in the text unless
   *  something else is taking the screen. */
  clear(select: FindReplaceMatch | null, focus: boolean): void;
  /** What is selected, as one line of text. */
  selectedText(): string;
  /** `match` brought into view. */
  reveal(match: FindReplaceMatch, smooth: boolean): void;
  focus(): void;
  /** Whether `el` is in this editor's text. */
  contains(el: Element): boolean;
}
