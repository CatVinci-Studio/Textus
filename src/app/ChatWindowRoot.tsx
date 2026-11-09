import { useRef } from "react";
import { ChatWindowApp } from "../ai/chat/window/ChatWindowApp";
import { AgentTabs } from "./AgentTabs";
import { useTabRows } from "./layout/useTabRows";
import "./tabs/TabBar.css";
import "./layout/layout-tokens.css";
import "./layout/layout.css";
import "./layout/agent-tabs.css";

/** The detached chat window: one AI island under its row of conversations,
 *  the docked panel's tabs (AgentTabs), measured as the editor's rows. */
export function ChatWindowRoot() {
  const body = useRef<HTMLElement>(document.body);
  useTabRows(body);
  return (
    <ChatWindowApp tabs={(props) => <AgentTabs {...props} popOut={false} />} />
  );
}
