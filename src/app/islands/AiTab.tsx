import { useEffect, useRef } from "react";
import { AgentIslandTools } from "./AgentTabs";
import { newConversation } from "./ai-tabs";
import { TextusAiOffNote } from "../../ai/TextusAiSwitch";
import {
  WindowConversation,
  windowConversation,
} from "../../ai/chat/panel/window-conversation";
import { useSettings } from "../../prefs/SettingsContext";
import "./ai-tab.css";

/**
 * An AI conversation's tab: its conversation, drawn from the window's own
 * model of it, History at its corner, and its menu on its paper. With
 * Textus AI off, it says so.
 */
export function AiTab({ conversation }: { conversation: string }) {
  const { settings, t } = useSettings();
  const on = settings.textusAi;
  const newSlot = useRef<(() => void) | null>(null);
  // Nothing draws the conversations while off: what runs stops here.
  useEffect(() => {
    if (!on) windowConversation.peek()?.stopConversations();
  }, [on]);
  if (!on) return <TextusAiOffNote className="agent-panel-placeholder" />;
  return (
    <div className="ai-tab">
      <div className="agent-panel-mount">
        <WindowConversation conversation={conversation} newSlot={newSlot} />
      </div>
      <AgentIslandTools
        t={t}
        onNew={() => newConversation(conversation, () => newSlot.current?.())}
      />
    </div>
  );
}
