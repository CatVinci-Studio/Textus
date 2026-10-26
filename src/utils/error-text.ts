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
