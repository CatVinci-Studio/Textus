import { useEffect, useState } from "react";
import { ai, auth } from "../platform/ipc";
import type { Settings } from "../prefs/SettingsContext";
import type { ImageProviderEntry_Serialize } from "../platform/bindings/ai-agent";

/** A service Settings offers as the image model, from the backend's list. */
export type ImageProviderEntry = ImageProviderEntry_Serialize;

/** The setting as a request carries it. */
export interface ImageModel {
  provider: string;
  model: string;
  baseUrl: string;
  /** At most this many pictures per request. */
  limit: number;
}

/** The default setting: follow the chat provider. Must match the backend's. */
export const FOLLOW_CHAT = "chat";

/** The image service that goes with a chat provider, by the backend's rule
 *  (images/services.rs following_chat) over its list: its sign-in's while
 *  there is one, else the provider's own on the same key; null when it
 *  makes none. */
function followingChat(
  entries: readonly ImageProviderEntry[],
  chatProvider: string,
  chatGptSignedIn: boolean,
): string | null {
  const signIn = entries.find((e) => e.signInFor === chatProvider);
  if (signIn && chatGptSignedIn) return signIn.id;
  return (
    entries.find((e) => e.keyId === chatProvider && e.id === chatProvider)
      ?.id ?? null
  );
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

/** The image service these settings make pictures with (the chosen one, or
 *  the chat provider's while following it), or null. */
export function useImageService(
  settings: Pick<Settings, "imageModelProvider" | "aiProvider">,
): string | null {
  const signedIn = useChatGptSignedIn();
  const entries = useImageProviders();
  const chosen = settings.imageModelProvider;
  if (chosen === FOLLOW_CHAT)
    return followingChat(entries, settings.aiProvider, signedIn);
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

let providers: Promise<ImageProviderEntry[]> | null = null;

/** The backend's image services, asked once per window. */
function loadImageProviders(): Promise<ImageProviderEntry[]> {
  providers ??= ai
    .listImageProviders()
    .then((list) => (Array.isArray(list) ? list : []))
    .catch(() => {
      providers = null;
      return [];
    });
  return providers;
}

/** The image services; empty until they arrive. */
export function useImageProviders(): ImageProviderEntry[] {
  const [entries, setEntries] = useState<ImageProviderEntry[]>([]);
  useEffect(() => {
    let live = true;
    void loadImageProviders().then((list) => live && setEntries(list));
    return () => {
      live = false;
    };
  }, []);
  return entries;
}
