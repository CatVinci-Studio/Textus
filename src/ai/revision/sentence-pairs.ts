/** Text cut into sentences, each keeping the space and breaks after it, so
 *  they join back into the text exactly. */

/** A sentence ended: any script's full stop, a question or exclamation
 *  mark, a semicolon or an ellipsis, then its closing quotes. */
export const SENTENCE_END = /[。！？!?.;；؟।…][”’"')）」』\]]*\s*$/;

export function splitSentences(text: string): string[] {
  // A full stop ends a sentence only before a space, a line break or the
  // end, not in 3.14 or a URL. A picture's `![` is no exclamation.
  const parts =
    text.match(
      /(?:[^。！？!?.;；؟।…\n]|\.(?!\s|$|\\\n|<br\s*\/?>)|!(?=\[))*(?:[。！？!?;；؟।…]+|\.|\n+|$)[”’"')）」』\]]*(?:\\\n|<br\s*\/?>|\s)*/g,
    ) ?? [];
  const out = parts.filter((p) => p.length > 0);
  // Anything the pattern skipped (shouldn't happen) is kept rather than lost.
  return out.join("") === text ? out : [text];
}
