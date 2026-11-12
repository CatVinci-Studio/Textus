import { ChatWindowApp } from "../ai/chat/window/ChatWindowApp";
import { AgentTabs } from "./islands/AgentTabs";
import "../engine/controls/tabs/TabBar.css";
import "../engine/tokens/layout-tokens.css";
import "./islands/agent-tabs.css";

/** The detached chat window: one AI island under its row of conversations,
 *  the docked panel's tabs (AgentTabs), its row's insets as the editor's rows'. */
export function ChatWindowRoot() {
  return <ChatWindowApp tabs={(props) => <AgentTabs {...props} />} />;
}
