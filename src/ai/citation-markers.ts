/**
 * Citation markers OpenAI's models write in their own app's format
 * (`\ue200cite\ue202turn3view0\ue201`, or delimiters lost). The backend strips
 * them from finished text; this does it for text still streaming in.
 */

const DELIMITED = /\s*\ue200[^\ue201]*\ue201/g;
const BARE = /\s*cite(?:turn\d+[a-z_]+\d+)+/g;
/** The start of a marker at the very end of text still arriving. */
const STARTED =
  /\s*(?:\ue200[^\ue201]*|c(?:i(?:t(?:e(?:t(?:u(?:r(?:n\d*[a-z_]*\d*)?)?)?)?)?)?)?)$/;

export function withoutCitationMarkers(
  text: string,
  streaming = false,
): string {
  if (!text.includes("\ue200") && !text.includes("citeturn") && !streaming)
    return text;
  let out = text
    .replace(DELIMITED, "")
    .replace(BARE, "")
    .replace(/[\ue200-\ue2ff]/g, "");
  if (streaming) {
    const started = STARTED.exec(out);
    // "c" alone ends many words: only a run that can't be a word's end.
    if (started && /(?:\ue200|citet)/.test(started[0]))
      out = out.slice(0, started.index);
  }
  return out;
}
