import { createContext, useContext } from "react";
import { useSettingsIfAny } from "../../../prefs/SettingsContext";

interface WhoAnswers {
  /** An outside agent's key, "" for Textus AI. */
  agent: string;
  setAgent: (agent: string) => void;
}

const Conversation = createContext<WhoAnswers | null>(null);

/** Set by a conversation's panel: who answers in it. */
export const WhoAnswersProvider = Conversation.Provider;

/** Who answers in the conversation around; outside one (Quick Ask, Create),
 *  the setting a new conversation starts with. */
export function useWhoAnswers(): WhoAnswers {
  const own = useContext(Conversation);
  const settings = useSettingsIfAny();
  return (
    own ?? {
      agent: settings?.settings.chatAgent ?? "",
      setAgent: (agent) => settings?.setSettings({ chatAgent: agent }),
    }
  );
}
