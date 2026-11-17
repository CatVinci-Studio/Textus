import type { SnippetContribution } from "../store/manifest-types";
import { INSERT_MARKDOWN_EVENT, sendAppEvent } from "../../utils/events";

/** A plugin's snippet as the `/` menu offers it: a line goes in as typed
 *  text, its caret at `$0`; more than one goes in as Markdown blocks. */
export function snippetItem(
  snippet: SnippetContribution,
  text: (value: string) => string,
  plugin: string,
) {
  const body = text(snippet.body);
  const line = !body.includes("\n");
  return {
    label: text(snippet.label),
    detail: plugin,
    keywords: snippet.keywords && text(snippet.keywords),
    shown: () => true,
    insert: line ? body : undefined,
    run: line
      ? undefined
      : () => sendAppEvent(INSERT_MARKDOWN_EVENT, body.replace("$0", "")),
  };
}
