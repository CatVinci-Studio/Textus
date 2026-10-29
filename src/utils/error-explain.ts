import type { Strings, TextKey } from "../i18n/strings";
import { errorText } from "./error-text";

/**
 * Failures recognized in an error's text, said in the user's language. A
 * system's message (which Windows writes in its own language, the others in
 * English) stays below; Textus' own English is replaced, or dropped where
 * the caller's heading already says it all (`null`).
 */
const KINDS: { text: TextKey | null; pattern: RegExp; own?: true }[] = [
  {
    text: null,
    pattern:
      /^(PDF export (failed|ended without a result)|Failed to render PDF)/,
    own: true,
  },
  { text: "errorTimeout", pattern: /^PDF export timed out/, own: true },
  {
    text: "errorFileTooBig",
    pattern:
      /^(The file is too big to open here|This Word document is too large to open)/,
    own: true,
  },
  {
    text: "errorNotDocument",
    pattern: /^(It isn't a document Textus can read\.|Not a document)$/,
    own: true,
  },
  { text: "errorBadName", pattern: /^Invalid (file )?name\.?$/, own: true },
  {
    text: "errorMoveIntoItself",
    pattern: /^A folder can't move into itself/,
    own: true,
  },
  {
    text: "errorPluginTooBig",
    pattern: /too large to install\.$|^The plugin is too big/,
    own: true,
  },
  {
    text: "errorCatalogNewer",
    pattern: /^The plugin catalog is for a newer Textus/,
    own: true,
  },
  {
    text: "errorImageTooBig",
    pattern: /^image is empty or exceeds the 25 MB limit/,
    own: true,
  },
  { text: "errorNoFolder", pattern: /^No folder is open\.$/, own: true },
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
  const kind = KINDS.find((k) => k.pattern.test(raw));
  if (!kind) return raw;
  const lead = kind.text ? t[kind.text] : "";
  if (kind.own) return lead;
  return `${lead}\n${raw}`;
}
