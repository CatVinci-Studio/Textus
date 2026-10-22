import { useEffect, useState } from "react";
import { ai, auth } from "../platform/ipc";
import type { Settings } from "../settings/SettingsContext";

/**
 * A service Settings › Textus AI › Image model offers. Mirrors
 * `ImageProviderEntry` in src-tauri/src/ai/images.rs, which the list comes
 * from.
 */
export interface ImageProviderEntry {
  id: string;
  /** A brand name; "custom" and "doubao" are localized (imageProviderLabel). */
  label: string;
  api: string;
  /** Null for the OpenAI-compatible endpoint, whose address is typed in. */
  baseUrl: string | null;
  /** Where its key is kept - the chat provider's own id where one key
   *  serves both, so a provider set up for chat asks for nothing more. */
  keyId: string;
  /** The default first; empty for the compatible endpoint. */
  models: string[];
}

/** The setting as a request carries it. Mirrors `ImageModel` in
 *  src-tauri/src/ai/images.rs. */
export interface ImageModel {
  provider: string;
  model: string;
  baseUrl: string;
  /** At most this many pictures per request. */
  limit: number;
}

/** The setting that follows the chat provider, the default. Mirrors
 *  FOLLOW_CHAT in src-tauri/src/ai/images.rs, which resolves it. */
export const FOLLOW_CHAT = "chat";

/** The image service that goes with a chat provider, as the backend picks
 *  it (following_chat in ai/images/services.rs): the one its sign-in brings
 *  while there is one (OpenAI's through the ChatGPT sign-in), else the
 *  provider's own pictures on the same key; null for a chat provider that
 *  makes none. */
const SIGN_IN_IMAGES: Partial<Record<string, string>> = {
  openai: "openai-chatgpt",
};

const SAME_KEY_IMAGES = new Set([
  "openai",
  "google",
  "doubao",
  "qwen",
  "zhipu",
  "minimax",
  "minimax-intl",
  "siliconflow",
]);

export function followingChat(
  chatProvider: string,
  chatGptSignedIn: boolean,
): string | null {
  const signInImages = SIGN_IN_IMAGES[chatProvider];
  if (signInImages && chatGptSignedIn) return signInImages;
  return SAME_KEY_IMAGES.has(chatProvider) ? chatProvider : null;
}

/** Whether a ChatGPT sign-in is kept, for following an OpenAI chat. */
export function useChatGptSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let live = true;
    void auth
      .oauthStatus("openai")
      .then((status) => live && setSignedIn(!!status?.configured))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return signedIn;
}

/** The image service that makes the pictures under these settings - the
 *  one chosen, or the chat provider's own while following it - or null
 *  for none. */
export function useImageService(
  settings: Pick<Settings, "imageModelProvider" | "aiProvider">,
): string | null {
  const signedIn = useChatGptSignedIn();
  const chosen = settings.imageModelProvider;
  if (chosen === FOLLOW_CHAT)
    return followingChat(settings.aiProvider, signedIn);
  return chosen || null;
}

/** The image model a request is sent with, or null for none. */
export function imageModelOf(
  settings: Pick<
    Settings,
    | "imageModelProvider"
    | "imageModel"
    | "imageModelEndpoint"
    | "imagesPerRequest"
  >,
): ImageModel | null {
  if (!settings.imageModelProvider) return null;
  return {
    provider: settings.imageModelProvider,
    model: settings.imageModel,
    baseUrl: settings.imageModelEndpoint,
    limit: settings.imagesPerRequest,
  };
}

/** The image catalog, fetched once per mount; empty until it arrives (and
 *  in the dev shim, where the command answers null). */
export function useImageProviders(): ImageProviderEntry[] {
  const [entries, setEntries] = useState<ImageProviderEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    ai.listImageProviders()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setEntries(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return entries;
}
