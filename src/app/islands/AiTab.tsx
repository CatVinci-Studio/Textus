import { useCallback, useEffect, useState } from "react";
import { AgentIslandTools } from "./AgentTabs";
import { TextusAiOffNote } from "../../ai/TextusAiSwitch";
import { useSettings } from "../../prefs/SettingsContext";
import { setAiMount } from "./ai-tabs";
import { StandaloneChat } from "../../ai/chat/StandaloneChat";
import "./ai-tab.css";

/**
 * An AI conversation's tab: the element its conversation is drawn into (by
 * the document in front's editor, while it is the live one), History at
 * its corner, and its menu on its paper. With Textus AI off, it says so.
 */
export function AiTab({ tabId }: { tabId: string }) {
  const { settings, t } = useSettings();
  const [mountEl, setMountEl] = useState<HTMLElement | null>(null);
  const mount = useCallback(
    (el: HTMLElement | null) => {
      setAiMount(tabId, el);
      setMountEl(el);
    },
    [tabId],
  );
  const hosted = useHosted(mountEl);
  if (!settings.textusAi)
    return <TextusAiOffNote className="agent-panel-placeholder" />;
  return (
    <div className="ai-tab">
      <div className="agent-panel-mount" ref={mount} hidden={!hosted} />
      {/* No document's editor draws the conversation: its own. */}
      {!hosted && mountEl && <StandaloneChat />}
      <AgentIslandTools t={t} />
    </div>
  );
}

/** Whether a document's editor draws into `mount` (a frame's grace, so a
 *  document opening with the AI doesn't flash the stand-alone chat). */
function useHosted(mount: HTMLElement | null): boolean {
  const [hosted, setHosted] = useState(true);
  useEffect(() => {
    if (!mount) return;
    const check = () => setHosted(mount.childElementCount > 0);
    const frame = requestAnimationFrame(check);
    const observer = new MutationObserver(check);
    observer.observe(mount, { childList: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [mount]);
  return hosted;
}
