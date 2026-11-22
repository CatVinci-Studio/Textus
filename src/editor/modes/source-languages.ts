import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { LINE_LIMIT, TOKEN_TYPES, matchAt } from "../code/code-grammar";
import { addedLanguage, type AddedLanguage } from "../code/code-languages";

/** A plugin's grammar as a CodeMirror language: the same rules read at the
 *  same places as the rich editor's (code-grammar.ts). Asked each time,
 *  so a grammar the editor dropped as too slow goes plain here too. */
function streamLanguage(added: AddedLanguage) {
  return StreamLanguage.define<null>({
    name: added.language.id,
    startState: () => null,
    token(stream) {
      const grammar = added.now();
      if (!grammar || stream.string.length > LINE_LIMIT) {
        stream.skipToEnd();
        return null;
      }
      const hit = matchAt(grammar, stream.string, stream.pos);
      if (!hit) {
        stream.next();
        return null;
      }
      stream.pos = hit.end;
      return TOKEN_TYPES[hit.type].tag;
    },
  });
}

const described = new WeakMap<AddedLanguage, LanguageDescription>();

function description(added: AddedLanguage): LanguageDescription {
  let found = described.get(added);
  if (!found) {
    const { id, aliases } = added.language;
    found = LanguageDescription.of({
      name: id,
      alias: [...aliases],
      // Read when a fence first names it; a grammar that can't be used
      // leaves the block plain rather than failing the parse.
      load: () =>
        added.load().then(() => new LanguageSupport(streamLanguage(added))),
    });
    described.set(added, found);
  }
  return found;
}

/** The language a fence's info string names: CodeMirror's own first, then
 *  one a plugin added. */
export function fenceLanguage(info: string): LanguageDescription | null {
  const own = LanguageDescription.matchLanguageName(languages, info, true);
  if (own) return own;
  const added = addedLanguage(info.trim().split(/\s/)[0] ?? "");
  return added && description(added);
}
