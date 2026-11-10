import { useRef } from "react";
import { ChatWindowApp } from "../ai/chat/window/ChatWindowApp";
import { AgentTabs } from "./islands/AgentTabs";
import { useTabRows } from "./layout/useTabRows";
import "./tabs/TabBar.css";
import "../engine/tokens/layout-tokens.css";
import "./islands/agent-tabs.css";

/** The detached chat window: one AI island under its row of conversations,
 *  the docked panel's tabs (AgentTabs), measured as the editor's rows. */
export function ChatWindowRoot() {
  const body = useRef<HTMLElement>(document.body);
  useTabRows(body);
  return (
    <ChatWindowApp tabs={(props) => <AgentTabs {...props} popOut={false} />} />
  );
}
