import { ai } from "../../../platform/ipc";
import type { Strings } from "../../../i18n/strings";
import { getUiState, setUiState } from "../../../storage/ui-state";
import { showConfirm, showMessage } from "../../../ui/app-dialog";
import { errorText } from "../../../utils/error-text";

// A project made with Levis keeps its style profile, library, writing
// instructions and skills in .levis/, which Textus no longer reads
// (src-tauri ai/levis_project.rs): the project bar asks once whether to
// convert it. "Not now" is remembered per project folder in ui-state.json -
// never in the user's folder - and the Memory tab keeps a quiet "Convert
// Levis data" for later.

/** Project folders asked in this session, so a second project bar (the
 *  Memory tab's) or a re-mount doesn't ask again while one is open. */
const asked = new Set<string>();

function declined(): string[] {
  const value = getUiState("levisProjectsDeclined");
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/** Whether the project bar should ask about `root` now. */
export function shouldOfferLevisConversion(root: string): boolean {
  return !asked.has(root) && !declined().includes(root);
}

/** Copies .levis/ into .textus/ and says how it went. Resolves true when
 *  it converted. */
export async function convertLevisProject(
  t: Strings,
  docPath: string | null,
  workspaceRoot: string | null,
): Promise<boolean> {
  try {
    const copied = await ai.convertLevisProject(docPath, workspaceRoot);
    await showMessage(t.levisProjectDone.replace("{n}", String(copied)), {
      title: t.levisProjectTitle,
    });
    return true;
  } catch (err) {
    await showMessage(errorText(err), {
      title: t.levisProjectTitle,
      tone: "error",
    });
    return false;
  }
}

/** The one-time question. Resolves true when the project was converted. */
export async function offerLevisConversion(
  t: Strings,
  root: string,
  docPath: string | null,
  workspaceRoot: string | null,
): Promise<boolean> {
  if (!shouldOfferLevisConversion(root)) return false;
  asked.add(root);
  const convert = await showConfirm(t.levisProjectText, {
    title: t.levisProjectTitle,
    okLabel: t.levisProjectConvert,
    cancelLabel: t.levisProjectLater,
  });
  if (!convert) {
    setUiState("levisProjectsDeclined", [...declined(), root]);
    return false;
  }
  return convertLevisProject(t, docPath, workspaceRoot);
}

/** Forgets this session's questions, for tests. */
export function resetLevisOffersForTests(): void {
  asked.clear();
}
