import { createSubscribers } from "../../utils/store";
import { compileGrammar, type Grammar } from "./code-grammar";

/**
 * Code languages others add (plugins' `contributes.codeLanguages`): the
 * names a fence may use for each, and its grammar, read from its file the
 * first time a block shows the language - never for a document without one.
 */

export interface CodeLanguage {
  id: string;
  aliases: readonly string[];
  /** The grammar file's text (code-grammar.ts reads it). */
  load: () => Promise<string>;
}

/** One added language, with its grammar once read. */
export class AddedLanguage {
  /** undefined until read; null when it can't be used. */
  private grammar: Grammar | null | undefined;
  private loading: Promise<Grammar | null> | null = null;

  constructor(readonly language: CodeLanguage) {}

  /** The grammar, read once; null when the file can't be read. */
  load(): Promise<Grammar | null> {
    return (this.loading ??= this.language
      .load()
      .then((text) => {
        const { grammar, problems } = compileGrammar(JSON.parse(text));
        if (problems.length)
          console.warn(`Code language ${this.language.id}:`, problems);
        return grammar;
      })
      .catch((err: unknown) => {
        console.warn(`Code language ${this.language.id}:`, err);
        return null;
      })
      .then((grammar) => {
        if (this.grammar === undefined) this.grammar = grammar;
        if (entries.includes(this)) changed();
        return this.grammar ?? null;
      }));
  }

  /** The grammar if it's read; otherwise null, and it starts being read. */
  now(): Grammar | null {
    if (this.grammar === undefined) void this.load();
    return this.grammar ?? null;
  }

  /** Too slow to read a block in time: plain for the rest of the session. */
  drop(): void {
    if (this.grammar === null) return;
    console.warn(`Code language ${this.language.id} is too slow; left plain.`);
    this.grammar = null;
    // Not now: this runs inside an editor's state update, and the change
    // makes every editor dispatch.
    queueMicrotask(changed);
  }
}

const entries: AddedLanguage[] = [];
let names: readonly string[] = [];
let version = 0;
const subscribers = createSubscribers();

function changed() {
  version++;
  names = [...new Set(entries.map((e) => e.language.id))];
  subscribers.publish();
}

/** Adds a language until the returned function is called. Two adding the
 *  same name: the first keeps it, the next takes over when it goes. */
export function addCodeLanguage(language: CodeLanguage): () => void {
  const entry = new AddedLanguage({
    ...language,
    id: language.id.toLowerCase(),
    aliases: language.aliases.map((a) => a.toLowerCase()),
  });
  entries.push(entry);
  changed();
  return () => {
    const at = entries.indexOf(entry);
    if (at < 0) return;
    entries.splice(at, 1);
    changed();
  };
}

/** The added language a fence's `name` means, in any case; null for none. */
export function addedLanguage(name: string): AddedLanguage | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return (
    entries.find(
      ({ language }) => language.id === key || language.aliases.includes(key),
    ) ?? null
  );
}

/** The added languages' ids, the same list until one comes or goes. */
export const addedLanguageNames = (): readonly string[] => names;

/** Counts the changes onAddedLanguages tells: an editor made while a
 *  grammar was being read compares it to see what it missed. */
export const addedLanguagesVersion = (): number => version;

/** A language added or taken away, or a grammar read. */
export const onAddedLanguages = subscribers.subscribe;
