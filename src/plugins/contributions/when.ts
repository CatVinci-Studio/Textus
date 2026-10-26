/**
 * A menu item's `when` (contributes.menus): whether it shows now, as VS
 * Code's when clauses say it - `editorHasSelection`, `fileExtension ==
 * .pdf`, `view == catvinci.tasks.list && !folderOpen`. Keys the context
 * doesn't know are false; a clause that can't be read shows the item.
 */
export type WhenContext = Record<string, string | boolean | undefined>;

type Token = { kind: "op" | "word"; text: string };

function tokens(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      i++;
    } else if (source.startsWith("&&", i) || source.startsWith("||", i)) {
      out.push({ kind: "op", text: source.slice(i, i + 2) });
      i += 2;
    } else if (source.startsWith("==", i) || source.startsWith("!=", i)) {
      out.push({ kind: "op", text: source.slice(i, i + 2) });
      i += 2;
    } else if (c === "!" || c === "(" || c === ")") {
      out.push({ kind: "op", text: c });
      i++;
    } else if (c === "'" || c === '"') {
      const end = source.indexOf(c, i + 1);
      const stop = end < 0 ? source.length : end;
      out.push({ kind: "word", text: source.slice(i + 1, stop) });
      i = stop + 1;
    } else {
      let j = i;
      while (j < source.length && !/[\s!=&|()]/.test(source[j])) j++;
      if (j === i) j++;
      out.push({ kind: "word", text: source.slice(i, j) });
      i = j;
    }
  }
  return out;
}

export function evaluateWhen(
  clause: string | undefined,
  context: WhenContext,
): boolean {
  if (!clause?.trim()) return true;
  const list = tokens(clause);
  let at = 0;
  const peek = () => list[at];
  const take = () => list[at++];
  const value = (key: string) => context[key];

  function or(): boolean {
    let result = and();
    while (peek()?.text === "||") {
      take();
      const right = and();
      result = result || right;
    }
    return result;
  }
  function and(): boolean {
    let result = not();
    while (peek()?.text === "&&") {
      take();
      const right = not();
      result = result && right;
    }
    return result;
  }
  function not(): boolean {
    if (peek()?.text === "!") {
      take();
      return !not();
    }
    if (peek()?.text === "(") {
      take();
      const inner = or();
      if (peek()?.text === ")") take();
      return inner;
    }
    const word = take();
    if (!word || word.kind !== "word") throw new Error("A key is missing.");
    const op = peek();
    if (op?.text === "==" || op?.text === "!=") {
      take();
      const right = take();
      if (!right || right.kind !== "word")
        throw new Error("A value is missing.");
      const left = value(word.text);
      const equal =
        String(left ?? "").toLowerCase() === right.text.toLowerCase();
      return op.text === "==" ? equal : !equal;
    }
    return !!value(word.text);
  }

  try {
    const result = or();
    return at >= list.length ? result : true;
  } catch {
    return true;
  }
}
