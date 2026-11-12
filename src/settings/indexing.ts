import { createContext, useContext } from "react";

/** Inside Settings' search index: pages drawn out of sight only to read
 *  their rows, which must fetch, ask the keychain or change nothing. */
export const SettingsIndexing = createContext(false);

export const useSettingsIndexing = () => useContext(SettingsIndexing);
