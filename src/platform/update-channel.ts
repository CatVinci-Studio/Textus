/** Settings' `updateChannel`: "stable" reads the newest stable release,
 *  "beta" also gets release candidates; Rust treats anything else as stable. */
export type UpdateChannel = "stable" | "beta";
export const UPDATE_CHANNELS: readonly UpdateChannel[] = ["stable", "beta"];
