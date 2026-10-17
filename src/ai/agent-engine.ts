import { useSyncExternalStore } from "react";
export type AgentEngine = "harness" | "codex" | "claude-code";
const key = "textus-agent-engine";
export function selectedEngine(): AgentEngine {
  const value = localStorage.getItem(key);
  return value === "codex" || value === "claude-code" ? value : "harness";
}
export function selectEngine(engine: AgentEngine) {
  localStorage.setItem(key, engine);
  window.dispatchEvent(new Event("textus-engine-change"));
}
function subscribe(fn: () => void) {
  window.addEventListener("textus-engine-change", fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener("textus-engine-change", fn);
    window.removeEventListener("storage", fn);
  };
}
export function useAgentEngine() {
  return useSyncExternalStore(
    subscribe,
    selectedEngine,
    () => "harness" as const,
  );
}
export function engineModel(engine: AgentEngine): string | null {
  return localStorage.getItem(`textus-engine-model-${engine}`) || null;
}
