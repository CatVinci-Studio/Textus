import { useEffect, useState, useSyncExternalStore } from "react";
import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { ToggleRow } from "../sections/controls";
import {
  AgentSystemPromptSection,
  AgentWorkspaceRootSection,
  AgentWorkspaceSection,
} from "../sections/agent";
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
import {
  canPickFolder,
  canRevealInFileManager,
} from "../../platform/capabilities";

/**
 * Settings › Textus AI › Memory & Skills: what the AI knows of the project
 * and of the writer; the skills it has - each mode's built-in ones, then
 * one's own (import at the section's end); then the catalog's to install.
 */
export function MemoryPage({
  t,
  settings,
  setSettings,
  onOpenFile,
  onFilesDeleted,
  onClose,
}: SettingsPageProps) {
  const [error, setError] = useState<string | null>(null);
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  useEffect(() => {
    void loadCatalog();
  }, []);
  if (!settings.textusAi)
    return <p className="tx-list-note">{t.textusAiOffHint}</p>;
  return (
    <>
      <SettingsGroup title={t.memoryGroup}>
        <ToggleRow
          label={t.rememberAutomaticallyLabel}
          help={t.rememberAutomaticallyHint}
          checked={settings.rememberAutomatically}
          onChange={(v) => setSettings({ rememberAutomatically: v })}
        />
        {canPickFolder && <AgentWorkspaceRootSection t={t} />}
        <AgentSystemPromptSection
          t={t}
          onOpenFile={onOpenFile}
          onClose={onClose}
        />
        {canRevealInFileManager && <AgentWorkspaceSection t={t} />}
      </SettingsGroup>
      <SettingsGroup
        title={t.navSkills}
        actions={
          <button
            type="button"
            className="text-button settings-inline-button"
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
        <BuiltinSkillsSection
          t={t}
          bare
          onOpenFile={onOpenFile}
          onFilesDeleted={onFilesDeleted}
          onClose={onClose}
        />
        <OwnSkillsList t={t} onFilesDeleted={onFilesDeleted} />
      </SettingsGroup>
      <AvailableSkills t={t} catalog={catalog} query="" />
    </>
  );
}
