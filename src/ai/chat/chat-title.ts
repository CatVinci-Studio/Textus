import type { Strings } from "../../i18n/strings";

/** A conversation's name wherever it is shown - a tab, its tip, History:
 *  the title it was given, or "New conversation" until it has one. */
export const chatTitle = (title: string | null | undefined, t: Strings) =>
  title || t.chatNewConversation;

/** History's titles, by conversation id. */
export const chatTitles = (
  history: readonly { id: string; title: string }[],
): Map<string, string> =>
  new Map(history.map((entry) => [entry.id, entry.title]));
