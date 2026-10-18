import { useEffect, useState } from "react";
import {
  engineModel,
  selectEngine,
  useAgentEngine,
  type AgentEngine,
} from "../agent-engine";
export function EngineSelector({
  disabled = false,
  language = "en",
}: {
  disabled?: boolean;
  language?: string;
}) {
  const engine = useAgentEngine();
  const zh = language.startsWith("zh");
  const [model, setModel] = useState(() => engineModel(engine) ?? "");
  // The engine can change elsewhere (another window, another selector).
  useEffect(() => setModel(engineModel(engine) ?? ""), [engine]);
  return (
    <div className="agent-engine-controls">
      <select
        aria-label={zh ? "Agent 引擎" : "Agent engine"}
        value={engine}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value as AgentEngine;
          selectEngine(next);
          setModel(engineModel(next) ?? "");
        }}
      >
        <option value="harness">DeepSeek Harness</option>
        <option value="codex">Codex</option>
        <option value="claude-code">Claude Code</option>
      </select>
      {engine === "harness" ? (
        <span className="agent-model-label">
          {zh ? "设置中的模型" : "Configured model"}
        </span>
      ) : (
        <input
          aria-label={zh ? "引擎模型" : "Engine model"}
          value={model}
          disabled={disabled}
          placeholder={zh ? "默认模型" : "Default model"}
          onChange={(e) => {
            setModel(e.target.value);
            localStorage.setItem(
              `textus-engine-model-${engine}`,
              e.target.value.trim(),
            );
          }}
        />
      )}
      <span
        title={zh ? "所有修改均需审核后应用" : "All changes require review"}
      >
        {zh ? "审核后应用" : "Review changes"}
      </span>
    </div>
  );
}
