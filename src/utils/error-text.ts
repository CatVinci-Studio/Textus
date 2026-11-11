import ERRORS from "../i18n/errors.json";
/**
 * What a caught error says to a person: IpcError's message leads with the
 * command name, for logs. Recognized by name, not `instanceof`, since tests
 * mock ipc.ts wholesale.
 */
export function errorText(err: unknown): string {
  if (err instanceof Error && err.name === "IpcError" && "cause" in err)
    return errorText((err as Error & { cause: unknown }).cause);
  if (err instanceof Error) return err.message;
  return String(err);
}

/** A Textus error by its code, as the backend gives one (errors.rs): its
 *  English, then the code the user's words are found by. */
export function ownError(code: keyof typeof ERRORS): string {
  return `${ERRORS[code].en} [${code}]`;
}

/** The code a Textus error ends with ("… [exists]"), or null. */
export function errorCode(text: string): string | null {
  return /\s\[([a-z][a-zA-Z]*)\]$/.exec(text)?.[1] ?? null;
}

/**
 * A benign, expected outcome of an on-demand AI action ("no issues found"),
 * thrown with a code so the notice can be shown in the user's language.
 */
export class AiNoticeError extends Error {
  readonly code: AiNoticeCode;
  constructor(code: AiNoticeCode) {
    super(code);
    this.name = "AiNoticeError";
    this.code = code;
  }
}

export type AiNoticeCode =
  | "completion-needs-caret"
  | "completion-needs-paragraph-end"
  | "completion-empty"
  | "grammar-needs-paragraph"
  | "grammar-empty-paragraph"
  | "grammar-paragraph-changed"
  | "grammar-no-issues";
