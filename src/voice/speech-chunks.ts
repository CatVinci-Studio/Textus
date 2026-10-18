export interface SpeechChunk {
  text: string;
  start: number;
  end: number;
  paragraph: number;
}
/** Bound requests by Unicode scalar values, preserving source offsets for highlighting. */
export function speechChunks(text: string): SpeechChunk[] {
  const chunks: SpeechChunk[] = [];
  const paragraphs = /\S[\s\S]*?(?=\n[ \t]*\n|$)/g;
  let match: RegExpExecArray | null;
  let paragraph = 0;
  while ((match = paragraphs.exec(text))) {
    const chars = Array.from(match[0]);
    let cursor = 0;
    let offset = match.index;
    while (cursor < chars.length) {
      let end = Math.min(cursor + 600, chars.length);
      if (end < chars.length) {
        for (let index = end - 1; index >= cursor + 300; index--) {
          if (/[。！？.!?;；\n]/.test(chars[index])) {
            end = index + 1;
            break;
          }
        }
      }
      const raw = chars.slice(cursor, end).join("");
      const trimmed = raw.trim();
      if (trimmed) {
        const start = offset + raw.indexOf(trimmed);
        chunks.push({
          text: trimmed,
          start,
          end: start + trimmed.length,
          paragraph,
        });
      }
      offset += raw.length;
      cursor = end;
    }
    paragraph++;
  }
  return mergeShort(text, chunks);
}

/** Headings, list items and table rows are a few words each: one request
 *  per block meant hundreds of round trips and a pause before every line.
 *  Neighbouring blocks share a request while they stay within the limit. */
function mergeShort(text: string, chunks: SpeechChunk[]): SpeechChunk[] {
  const merged: SpeechChunk[] = [];
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (previous) {
      const joined = text.slice(previous.start, chunk.end);
      if (Array.from(joined).length <= 600) {
        merged[merged.length - 1] = {
          ...previous,
          text: joined,
          end: chunk.end,
        };
        continue;
      }
    }
    merged.push(chunk);
  }
  return merged;
}
