/** Text cut into sentences, each keeping the space and breaks after it, so
 *  they join back into the text exactly. */

/** A sentence ended: any script's full stop, a question or exclamation
 *  mark, a semicolon or an ellipsis, then its closing quotes. */
export const SENTENCE_END = /[。！？!?.;；؟।…][”’"')）」』\]]*\s*$/;

/** Where no sentence ends: a link's `](destination)` and a web address,
 *  whose `?` and `!` are the address's (`forum?id=3`). An address ends
 *  before the punctuation that closes its sentence. */
const UNSPLIT =
  /\]\([^)\n]*\)|(?:https?:\/\/|www\.)[^\s<>()[\]]*[^\s<>()[\].,;:!?。，；：！？]/
    .source;

const SENTENCE = new RegExp(
  `(?:${UNSPLIT}|[^。！？!?.;；؟।…\\n]|\\.(?!\\s|$|\\\\\\n|<br\\s*\\/?>)|!(?=\\[))*(?:[。！？!?;；؟।…]+|\\.|\\n+|$)[”’"')）」』\\]]*(?:\\\\\\n|<br\\s*\\/?>|\\s)*`,
  "g",
);

export function splitSentences(text: string): string[] {
  // A full stop ends a sentence only before a space, a line break or the
  // end, not in 3.14 or a URL. A picture's `![` is no exclamation.
  const parts = text.match(SENTENCE) ?? [];
  const out = parts.filter((p) => p.length > 0);
  // Anything the pattern skipped (shouldn't happen) is kept rather than lost.
  return out.join("") === text ? out : [text];
}
