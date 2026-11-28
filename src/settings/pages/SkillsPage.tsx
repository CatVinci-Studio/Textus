import { useEffect, useState, useSyncExternalStore } from "react";
import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import {
  BuiltinSkillsSection,
  OwnSkillsList,
  importSkill,
} from "../sections/skills";
import { AvailableSkills } from "../sections/market-skills";
import {
  catalogSnapshot,
  loadCatalog,
  subscribeCatalog,
} from "../../plugins/store/catalog";
import { explainError } from "../../utils/error-explain";

/**
 * Settings › Textus AI › Skills: each mode's built-in skills, then one's
 * own (import at that group's end), then the catalog's to install.
 */
export function SkillsPage({
  t,
  onOpenFile,
  onFilesDeleted,
  onClose,
  indexing,
}: SettingsPageProps) {
  const [error, setError] = useState<string | null>(null);
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  useEffect(() => {
    if (!indexing) void loadCatalog();
  }, [indexing]);
  return (
    <>
      <BuiltinSkillsSection
        t={t}
        title={t.skillsBuiltinGroup}
        onOpenFile={onOpenFile}
        onFilesDeleted={onFilesDeleted}
        onClose={onClose}
      />
      <SettingsGroup
        title={t.skillsOwnGroup}
        actions={
          <button
            type="button"
            className="tx-button text-button settings-inline-button"
            onClick={() =>
              void importSkill().then(
                () => setError(null),
                (err: unknown) => setError(explainError(err, t)),
              )
            }
          >
            {t.agentSkillsImport}
          </button>
        }
      >
        {error && (
          <div className="settings-error" role="alert">
            {error}
          </div>
        )}
        <OwnSkillsList t={t} onFilesDeleted={onFilesDeleted} />
      </SettingsGroup>
      <AvailableSkills t={t} catalog={catalog} query="" />
    </>
  );
}
