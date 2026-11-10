import { useEffect, useState, useSyncExternalStore } from "react";
import type { SettingsPageProps } from "./types";
import {
  BuiltinSkillsSection,
  OwnSkillsList,
  importSkill,
} from "../sections/skills";
import { AvailableSkills } from "../sections/market-skills";
import { ExtensionsTabLayout } from "./ExtensionsTabLayout";
import { requestCreate } from "../../ai/chat/create-request";
import {
  catalogSnapshot,
  loadCatalog,
  subscribeCatalog,
} from "../../plugins/store/catalog";
import { explainError } from "../../utils/error-explain";

/** Settings › Textus AI › Skills: one's own, the catalog's, and each
 *  mode's built-in ones. */
export function SkillsPage({
  t,
  settings,
  onOpenFile,
  onFilesDeleted,
  onClose,
  indexing,
}: SettingsPageProps) {
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  useEffect(() => {
    void loadCatalog();
  }, []);
  if (!settings.textusAi)
    return <p className="tx-list-note">{t.textusAiOffHint}</p>;
  return (
    <>
      {!indexing && (
        <ExtensionsTabLayout
          t={t}
          intro={t.extensionsIntroSkills}
          help={t.extensionsSkillsHelp}
          primary={{
            label: t.createMakeSkill,
            onSelect: () => requestCreate("", "skill"),
          }}
          query={query}
          onQuery={setQuery}
          actions={[
            {
              label: t.agentSkillsImport,
              onSelect: () =>
                void importSkill().then(
                  () => setError(null),
                  (err: unknown) => setError(explainError(err, t)),
                ),
            },
          ]}
          error={error}
          installedTitle={t.pluginsInstalledGroup}
          installed={
            <OwnSkillsList
              t={t}
              query={query}
              onFilesDeleted={onFilesDeleted}
            />
          }
          available={<AvailableSkills t={t} catalog={catalog} query={query} />}
        />
      )}

      <BuiltinSkillsSection
        t={t}
        onOpenFile={onOpenFile}
        onFilesDeleted={onFilesDeleted}
        onClose={onClose}
      />
    </>
  );
}
