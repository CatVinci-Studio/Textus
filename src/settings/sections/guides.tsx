import type { Lang, Strings } from "../../i18n/strings";
import { links } from "../../platform/ipc";
import { LinkRow } from "./controls";
import type { HelpGuide } from "../pages/types";

/** The guides as documents, and the videos: rows for a section. */
export function GuidesSection({
  t,
  language,
  openHelp,
}: {
  t: Strings;
  language: Lang;
  openHelp: (doc: HelpGuide) => void;
}) {
  return (
    <>
        <LinkRow
          label={t.menuHelpMarkdown}
          onOpen={() => openHelp("markdown")}
        />
        <LinkRow label={t.menuHelpAgent} onOpen={() => openHelp("agent")} />
        <LinkRow
          label={t.menuHelpTutorials}
          onOpen={() => void links.openTutorialsPage(language)}
        />
    </>
  );
}
