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
import { McpSection } from "../sections/mcp";
import { ExtensionsTabLayout } from "./ExtensionsTabLayout";
import { CreateTab } from "./CreateTab";
import { requestCreate } from "../../ai/chat/create-request";
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
 * Settings › Textus AI › Skills & Memory: what the AI knows of the project
 * and of the writer, the skills it has - one's own, the catalog's, each
 * mode's built-in ones - making a theme, plugin or skill with it, and MCP
 * servers.
 */
export function SkillsPage({
  t,
  settings,
  setSettings,
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
      <SettingsGroup title={t.agentPersonalizationGroupLabel}>
        {canPickFolder && <AgentWorkspaceRootSection t={t} />}
        <ToggleRow
          label={t.rememberAutomaticallyLabel}
          help={t.rememberAutomaticallyHint}
          checked={settings.rememberAutomatically}
          onChange={(v) => setSettings({ rememberAutomatically: v })}
        />
        <AgentSystemPromptSection
          t={t}
          onOpenFile={onOpenFile}
          onClose={onClose}
        />
        {canRevealInFileManager && <AgentWorkspaceSection t={t} />}
      </SettingsGroup>

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

      {/* Textus AI making a theme, plugin or skill, right here. */}
      {!indexing && (
        <SettingsGroup title={t.extensionsTabCreate}>
          <CreateTab t={t} />
        </SettingsGroup>
      )}

      <SettingsGroup title={t.extensionsTabMcp}>
        <McpSection t={t} />
      </SettingsGroup>
    </>
  );
}
