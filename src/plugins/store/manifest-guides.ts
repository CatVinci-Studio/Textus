import type {
  SnippetContribution,
  WalkthroughContribution,
} from "./manifest-types";
import { ManifestError, list, object, text, type Json } from "./manifest-json";

/** The longest snippet: a page, not a document. */
const LONGEST_SNIPPET = 20_000;

/** `contributes.snippets`: Markdown the `/` menu puts in at the caret
 *  (`$0` where it lands); no code. */
export function parseSnippets(c: Json): SnippetContribution[] {
  return list(c.snippets, "contributes.snippets").map((x, i) => {
    const at = `contributes.snippets[${i}]`;
    const o = object(x, at);
    const body = text(o.body, `${at}.body`);
    if (body.length > LONGEST_SNIPPET)
      throw new ManifestError(`${at}.body is longer than 20,000 characters.`);
    return {
      label: text(o.label, `${at}.label`),
      body,
      keywords: text(o.keywords, `${at}.keywords`, true) || undefined,
    };
  });
}

/** `contributes.walkthroughs`: a few steps for after it is installed, on
 *  its page in Settings; a step's command is the plugin's own. */
export function parseWalkthroughs(
  c: Json,
  commands: readonly string[],
): WalkthroughContribution[] {
  return list(c.walkthroughs, "contributes.walkthroughs").map((x, i) => {
    const at = `contributes.walkthroughs[${i}]`;
    const o = object(x, at);
    const steps = list(o.steps, `${at}.steps`).map((s, j) => {
      const where = `${at}.steps[${j}]`;
      const step = object(s, where);
      const command = text(step.command, `${where}.command`, true);
      if (command && !commands.includes(command))
        throw new ManifestError(
          `${where}.command isn't one of contributes.commands.`,
        );
      return {
        title: text(step.title, `${where}.title`),
        description: text(step.description, `${where}.description`, true),
        command: command || undefined,
      };
    });
    if (!steps.length) throw new ManifestError(`${at}.steps is empty.`);
    return { title: text(o.title, `${at}.title`), steps };
  });
}
