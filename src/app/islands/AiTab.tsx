import { useCallback } from "react";
import { AgentIslandTools } from "./AgentTabs";
import { TextusAiOffNote } from "../../ai/TextusAiSwitch";
import { useSettings } from "../../prefs/SettingsContext";
import { setAiMount } from "./ai-tabs";
import "./ai-tab.css";

/**
 * An AI conversation's tab: the element its conversation is drawn into (by
 * the document in front's editor, while it is the live one), History at
 * its corner, and its menu on its paper. With Textus AI off, it says so.
 */
export function AiTab({ tabId }: { tabId: string }) {
  const { settings, t } = useSettings();
  const mount = useCallback(
    (el: HTMLElement | null) => setAiMount(tabId, el),
    [tabId],
  );
  if (!settings.textusAi)
    return <TextusAiOffNote className="agent-panel-placeholder" />;
  return (
    <div className="ai-tab">
      <div className="agent-panel-mount" ref={mount} />
      <AgentIslandTools t={t} />
    </div>
  );
}
