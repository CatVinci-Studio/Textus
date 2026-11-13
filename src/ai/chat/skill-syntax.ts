/**
 * What a typed `/word` and `@path` look like in the composer, apart from the
 * pickers so the editor can read a skill command without loading them. CJK
 * IMEs type the slash as `、`, `／` or `・` and the at-sign as `＠`.
 */

/** The input is one `/word` still being typed: the skill picker is open. */
export const SKILL_TRIGGER = /^[/／、・](\S*)$/;
/** A whole `/word rest…` message: the word, then whatever follows it. */
export const SKILL_COMMAND = /^[/／、・](\S+)(?:\s+([\s\S]*))?$/;
/** An `@path` being typed at the end of the input: the file picker. */
export const MENTION_TRIGGER = /(?:^|\s)[@＠]([^\s@＠]*)$/;
/** The same `@path`, for removing it once a file is picked. */
export const MENTION_TOKEN = /(^|\s)[@＠][^\s@＠]*$/;

/** A message to an agent: a command typed with an IME's slash (`、`) in
 *  the "/" the agent reads, when the word names one of its commands. */
export function agentCommandText(typed: string, commands: { name: string }[]) {
  const word = SKILL_COMMAND.exec(typed)?.[1];
  return typed[0] !== "/" && commands.some((c) => c.name === word)
    ? `/${typed.slice(1)}`
    : typed;
}
