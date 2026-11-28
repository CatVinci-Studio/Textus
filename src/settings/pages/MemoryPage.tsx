import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { ToggleRow } from "../sections/controls";
import {
  AgentSystemPromptSection,
  AgentWorkspaceRootSection,
  AgentWorkspaceSection,
} from "../sections/agent";
import {
  canPickFolder,
  canRevealInFileManager,
} from "../../platform/capabilities";

/**
 * Settings › Textus AI › Memory & projects: what the AI keeps of the writer
 * (memory), and the project it works in: its folder, the writing
 * instructions, the global config folder. The skills have a page of their
 * own (SkillsPage).
 */
export function MemoryPage({
  t,
  settings,
  setSettings,
  onOpenFile,
  onClose,
}: SettingsPageProps) {
  return (
    <>
      <SettingsGroup title={t.memoryGroup}>
        <ToggleRow
          label={t.rememberAutomaticallyLabel}
          help={t.rememberAutomaticallyHint}
          checked={settings.rememberAutomatically}
          onChange={(v) => setSettings({ rememberAutomatically: v })}
        />
      </SettingsGroup>
      <SettingsGroup title={t.projectGroup}>
        {canPickFolder && <AgentWorkspaceRootSection t={t} />}
        <AgentSystemPromptSection
          t={t}
          onOpenFile={onOpenFile}
          onClose={onClose}
        />
        {canRevealInFileManager && <AgentWorkspaceSection t={t} />}
      </SettingsGroup>
    </>
  );
}
