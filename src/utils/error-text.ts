/**
 * What a caught error says to a person. ipc.ts's IpcError leads its message
 * with the internal command name ("agent_chat: Claude request failed
 * (401)"), which is for logs; the user gets what the backend actually said.
 * Recognized by name rather than `instanceof`, so this module doesn't
 * import ipc.ts (tests mock that module wholesale).
 */
export function errorText(err: unknown): string {
  if (err instanceof Error && err.name === "IpcError" && "cause" in err)
    return errorText((err as Error & { cause: unknown }).cause);
  if (err instanceof Error) return err.message;
  // Structured backend errors (media's `{ code, message }`) arrive as plain
  // objects; String() would show "[object Object]".
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof err.message === "string"
  )
    return err.message;
  return String(err);
}

/**
 * A benign, expected outcome of an on-demand AI action ("no issues found",
 * "put the caret at the end of a paragraph") - thrown with a code so the
 * notice can be shown in the user's language, unlike a free-form English
 * message built where the editor has no access to translations.
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
