import { useEffect, useState } from "react";
import { ai } from "../platform/ipc";
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
}

/** The image model a request is sent with, or null for none. */
export function imageModelOf(
  settings: Pick<
    Settings,
    "imageModelProvider" | "imageModel" | "imageModelEndpoint"
  >,
): ImageModel | null {
  if (!settings.imageModelProvider) return null;
  return {
    provider: settings.imageModelProvider,
    model: settings.imageModel,
    baseUrl: settings.imageModelEndpoint,
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
