/** The open-source licenses of everything Textus is built from, written
 *  into each build under this name by vite.third-party-notices.ts. */
const LICENSES_FILE = "open-source-licenses.md";

const UNBUILT =
  "# Open-source licenses\n\nThe list is written when Textus is built.\n";

/** The licenses document, from the app's own files. */
export async function licensesText(): Promise<string> {
  try {
    const res = await fetch(`/${LICENSES_FILE}`);
    const text = res.ok ? await res.text() : "";
    // The dev server answers a file it lacks with the app's page.
    if (text && !text.trimStart().startsWith("<")) return text;
  } catch {
    // Not built: said below.
  }
  return UNBUILT;
}
