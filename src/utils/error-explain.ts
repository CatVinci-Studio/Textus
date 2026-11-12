import type { Strings, TextKey } from "../i18n/strings";
import ERRORS_JSON from "../i18n/errors.json";
import { errorCode, errorText } from "./error-text";

const ERRORS = ERRORS_JSON as Record<string, { text: string | null }>;

/**
 * A system's failures recognized in an error's text, said in the user's
 * language; the system's message (which Windows writes in its own
 * language, the others in English) stays below. Textus' own errors come
 * with a code (i18n/errors.json).
 */
const KINDS: { text: TextKey; pattern: RegExp }[] = [
  {
    text: "errorPermission",
    pattern:
      /permission denied|operation not permitted|access is denied|\(os error (5|13)\)/i,
  },
  {
    text: "errorNotFound",
    pattern:
      /no such file or directory|cannot find the (file|path) specified|\(os error [23]\)/i,
  },
  {
    text: "errorDiskFull",
    pattern:
      /no space left on device|not enough space on the disk|\(os error (28|112)\)/i,
  },
  {
    text: "errorReadOnly",
    pattern: /read-only file system|write-protected|\(os error 30\)/i,
  },
  // Error 32 elsewhere is a broken pipe.
  {
    text: "errorFileBusy",
    pattern:
      /being used by another process|^(?!.*broken pipe).*\(os error 3[23]\)/is,
  },
  {
    text: "errorTimeout",
    pattern: /timed out|\btimeout\b/i,
  },
  {
    text: "errorNetwork",
    pattern:
      /error sending request|connection (refused|reset)|failed to lookup|dns error|tcp connect|network is unreachable/i,
  },
];

/** An error's text for a person: what happened in their language, and the
 *  system's own words below it when they add something. */
export function explainError(err: unknown, t: Strings): string {
  const raw = errorText(err);
  // Textus' own, by its code: said in full in the user's language, or left
  // to the caller's heading.
  const code = errorCode(raw);
  if (code) {
    const text = ERRORS[code]?.text;
    return text ? (t[text as TextKey] as string) : "";
  }
  const kind = KINDS.find((k) => k.pattern.test(raw));
  if (!kind) return raw;
  return `${t[kind.text]}\n${raw}`;
}
