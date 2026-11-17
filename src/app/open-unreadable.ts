import { fill } from "../i18n/fill";
import type { DocTab } from "../document/doc-tabs";
import { exportDoc } from "../platform/ipc";
import { showConfirm, showMessage } from "../engine/controls/app-dialog";
import type { DocumentPlace } from "../plugins/app-bridge";
import { customEditorFor } from "../plugins/store/plugin-lookup";
import { pluginTab } from "../document/plugin-tab";
import { basename } from "../utils/path";
import { isNotFoundError } from "../utils/error-explain";
import type { Strings } from "../i18n/strings";

/** Formats that are never text, though a small one may read as such
 *  (a PDF of plain ASCII, a zip): opened as text, a save would wreck it. */
const BINARY_STARTS = ["%PDF-", "PK\u0003\u0004"];

export function isBinaryContent(content: string): boolean {
  return BINARY_STARTS.some((start) => content.startsWith(start));
}

/** A file that wouldn't read as text: a market plugin offered to open it,
 *  or the system's app; else said why not. Its tab, or null. */
export async function openUnreadable(
  path: string,
  err: unknown,
  {
    reopening,
    place,
    t,
  }: {
    reopening: boolean;
    place?: DocumentPlace;
    t: Strings;
  },
): Promise<Partial<DocTab> | null> {
  const { offerPluginToOpen } = await import("../plugins/store/open-offer");
  // Gone, not of a kind no plugin opens: said so, no plugin offered.
  const gone = isNotFoundError(err);
  const offered = reopening || gone ? "none" : await offerPluginToOpen(path, t);
  if (offered === "system") {
    await exportDoc.openLinkedFile(path);
    return null;
  }
  const now = offered === "on" ? customEditorFor(path) : null;
  if (now) return pluginTab(path, now, place);
  // Its offer turned off: said that nothing here opens it, the system's
  // app a press away.
  if (offered === "muted") {
    const open = await showConfirm(
      fill(t.openFileMuted, {
        name: basename(path),
        page: t.navExtensions,
      }),
      { okLabel: t.pluginCardSystemApp, cancelLabel: t.cancel },
    );
    if (open) await exportDoc.openLinkedFile(path);
    return null;
  }
  if (offered === "none")
    void showMessage(
      fill(gone ? t.openFileGone : t.openFileFailed, {
        name: basename(path),
      }),
      { tone: "error" },
    );
  return null;
}
