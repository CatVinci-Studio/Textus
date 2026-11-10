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

/** Settings › Textus AI › Memory: what the AI knows of the project and of
 *  the writer - its folder, what it remembers, the writing instructions,
 *  where its own files are. */
export function MemoryPage({
  t,
  settings,
  setSettings,
  onOpenFile,
  onClose,
}: SettingsPageProps) {
  if (!settings.textusAi)
    return <p className="tx-list-note">{t.textusAiOffHint}</p>;
  return (
    <SettingsGroup>
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
  );
}
