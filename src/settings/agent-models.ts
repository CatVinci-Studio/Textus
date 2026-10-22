/// OpenAI's "sign in with ChatGPT" OAuth token can't list models (GET
/// /v1/models 403s - see the comment on fetch_agent_models in
/// src-tauri/src/ai/client/mod.rs), so that auth method gets a small hardcoded
/// list instead of a live fetch. The API-key auth method fetches live.
export const OPENAI_OAUTH_AGENT_MODEL_PRESETS = [
  { value: "", label: "gpt-6.1-sol (default)" },
  { value: "gpt-6-astra", label: "gpt-6-astra (strongest)" },
  { value: "gpt-6-luna", label: "gpt-6-luna (faster)" },
];

export const OPENAI_OAUTH_WRITING_MODEL_PRESETS = [
  { value: "", label: "gpt-6-luna (default, lower cost)" },
  { value: "gpt-6.1-sol", label: "gpt-6.1-sol (stronger)" },
  { value: "gpt-6-astra", label: "gpt-6-astra (strongest)" },
];
