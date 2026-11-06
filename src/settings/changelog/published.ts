import { collectNotes, type ReleaseNote } from "./changelog";
import { RELEASE_DATES } from "./release-dates";

// The notes as published, shared by every language's chunk.
const PUBLISHED = import.meta.glob<string>("../../../docs/releases/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Every version's notes, with a language's translations over them. */
export const withTranslations = (
  translated: Record<string, string>,
): ReleaseNote[] => collectNotes([PUBLISHED, translated], RELEASE_DATES);
