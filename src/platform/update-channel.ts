/** Settings' `updateChannel`: "stable" reads the newest stable release's
 *  manifest, "beta" also gets release candidates
 *  (src-tauri/src/commands/update.rs, which treats anything else as
 *  stable). */
export type UpdateChannel = "stable" | "beta";
export const UPDATE_CHANNELS: readonly UpdateChannel[] = ["stable", "beta"];
