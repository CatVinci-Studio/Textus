import { pluginsSnapshot } from "../store/plugin-records";
import { hasSlashItems, slashItemsFor } from "./slash-commands";

/**
 * Completions plugins suggest as you type. A plugin is asked, and started,
 * only when its manifest's pattern matches what is before the caret.
 */

export interface CompletionItem {
  /** What the list shows. */
  label: string;
  /** What replaces the matched text; `$0` marks where the caret goes. */
  insert: string;
  /** A word or two beside the label, dimmed. */
  detail?: string;
  /** Run once the item is taken (a `/` command): what was typed goes, and
   *  `insert` is empty. */
  run?: () => void;
}

export interface CompletionResult {
  /** How many characters before the caret the item replaces: the match. */
  replace: number;
  items: CompletionItem[];
}

/** The most items a list holds. */
const MAX_ITEMS = 50;
/** How long a plugin has to answer (starting takes a moment) before the next
 *  is asked. A list that arrives after the text moved on is not shown. */
const ANSWER_MS = 1500;

type Ask = (
  plugin: string,
  id: string,
  context: { text: string; match: string; inMath: boolean },
) => Promise<unknown>;

let ask: Ask | null = null;

/** The way to run a plugin's provider, starting it first. */
export function setCompletionAsker(run: Ask | null): void {
  ask = run;
}

interface Source {
  plugin: string;
  id: string;
  where: "math" | "text" | "any";
  pattern: RegExp;
}

let cachedFor: unknown = null;
let cached: Source[] = [];

function sources(): Source[] {
  const snapshot = pluginsSnapshot();
  if (snapshot === cachedFor) return cached;
  cachedFor = snapshot;
  cached = snapshot.allOn
    ? snapshot.records.flatMap((r) =>
        r.status === "on" && r.manifest && r.granted.includes("editor.read")
          ? r.manifest.contributes.completions.map((c) => ({
              plugin: r.id,
              id: c.id,
              where: c.where,
              // Anchored at the caret: what is typed last.
              pattern: new RegExp(`(?:${c.pattern})$`, "u"),
            }))
          : [],
      )
    : [];
  return cached;
}

export function hasCompletionSources(): boolean {
  return sources().length > 0 || hasSlashItems();
}

function items(value: unknown): CompletionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is CompletionItem =>
        !!v &&
        typeof (v as CompletionItem).label === "string" &&
        typeof (v as CompletionItem).insert === "string",
    )
    .slice(0, MAX_ITEMS)
    .map((v) => ({
      label: v.label,
      insert: v.insert,
      ...(typeof v.detail === "string" ? { detail: v.detail } : {}),
    }));
}

/** The first list a plugin has for the text before the caret in its
 *  paragraph or formula, or null. */
export async function provideCompletions(
  text: string,
  inMath: boolean,
): Promise<CompletionResult | null> {
  const slash = inMath ? null : slashItemsFor(text);
  if (slash)
    return {
      replace: slash.replace,
      items: slash.items.map((item) => ({
        label: item.label,
        insert: "",
        detail: item.detail,
        run: item.run,
      })),
    };
  if (!ask) return null;
  for (const source of sources()) {
    if (source.where !== "any" && (source.where === "math") !== inMath)
      continue;
    const match = source.pattern.exec(text)?.[0];
    if (!match) continue;
    const answer = await Promise.race([
      ask(source.plugin, source.id, { text, match, inMath }).catch(() => null),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), ANSWER_MS),
      ),
    ]);
    const list = items(answer);
    if (list.length > 0) return { replace: match.length, items: list };
  }
  return null;
}
