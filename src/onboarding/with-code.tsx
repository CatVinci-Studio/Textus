import type { ReactNode } from "react";

/** `text` with its code spans as code. As in Markdown, a span opened by a
 *  run of backticks closes at the next run as long; an unclosed run stays text. */
export function withCode(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      plain += text[i++];
      continue;
    }
    let n = 0;
    while (text[i + n] === "`") n++;
    const fence = "`".repeat(n);
    let close = text.indexOf(fence, i + n);
    while (close !== -1 && text[close + n] === "`") {
      let skip = close;
      while (text[skip] === "`") skip++;
      close = text.indexOf(fence, skip);
    }
    if (close === -1) {
      plain += fence;
      i += n;
      continue;
    }
    let code = text.slice(i + n, close);
    if (code.length > 2 && code.startsWith(" ") && code.endsWith(" "))
      code = code.slice(1, -1);
    if (plain) out.push(plain);
    plain = "";
    out.push(<code key={out.length}>{code}</code>);
    i = close + n;
  }
  if (plain) out.push(plain);
  return out;
}
