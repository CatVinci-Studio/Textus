/// OpenAI's "sign in with ChatGPT" token can't list models (GET /v1/models
/// 403s), so that auth method gets a hardcoded list instead.
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

/** A sign-in that takes only its own models, and can't list them: the
 *  presets offered instead, and what "default" means for each kind. */
export interface SignInModels {
  agent: { value: string; label: string }[];
  writing: { value: string; label: string }[];
  agentDefault: string;
  writingDefault: string;
}

export const SIGN_IN_MODELS: Partial<Record<string, SignInModels>> = {
  openai: {
    agent: OPENAI_OAUTH_AGENT_MODEL_PRESETS,
    writing: OPENAI_OAUTH_WRITING_MODEL_PRESETS,
    agentDefault: "gpt-6.1-sol",
    writingDefault: "gpt-6-luna",
  },
};
