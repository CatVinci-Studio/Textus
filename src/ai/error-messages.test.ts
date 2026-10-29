import { describe, expect, it } from "vitest";
import { classifyAiError, explainAiError } from "./error-messages";
import en from "../i18n/locales/en";

describe("classifyAiError", () => {
  it.each([
    ["Claude request failed (401 Unauthorized): invalid x-api-key", "auth"],
    ["This API key is not scoped to a workspace, so ...", "workspaceKey"],
    ["Could not list models (429 Too Many Requests)", "rateLimit"],
    [
      "DeepSeek request failed (402 Payment Required): Insufficient Balance",
      "balance",
    ],
    [
      "OpenAI request failed (429): You exceeded your current quota, please check your plan and billing details. insufficient_quota",
      "balance",
    ],
    [
      "Claude request failed (400): Your credit balance is too low to access the Anthropic API.",
      "balance",
    ],
    ["request failed (429): 余额不足或无可用资源包,请充值。", "balance"],
    ["request failed (400): Arrearage: Access denied", "balance"],
    ["Claude request failed (529): overloaded_error", "rateLimit"],
    ["request failed (503 Service Unavailable)", "server"],
    ["error sending request for url (https://api...)", "network"],
    ["operation timed out", "timeout"],
    [
      "This provider isn't set up yet - configure it in Settings > Textus AI.",
      "notConfigured",
    ],
    [
      "The 'gpt-x' model is not supported when using Codex with a ChatGPT account",
      "model",
    ],
  ])("%s -> %s", (text, kind) => {
    expect(classifyAiError(text)).toBe(kind);
  });
  it("leaves unknown errors alone", () => {
    expect(classifyAiError("something odd")).toBeNull();
    expect(explainAiError("something odd", en)).toBe("something odd");
  });
  it("puts what to do above the provider's message", () => {
    const text = "request failed (402): Insufficient Balance";
    expect(explainAiError(text, en)).toBe(`${en.aiErrorBalance}\n${text}`);
  });
});
