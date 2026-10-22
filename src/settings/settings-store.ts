import { storage } from "../platform/ipc";
import { gateAiRequests } from "../platform/ai-gate";
import { readBoot, readLocalJson } from "../storage/boot";
import { importLegacyStorage } from "../storage/legacy-import";
import { trackWrite } from "../storage/pending-writes";
import { listenToThisWindow } from "../utils/tauri-events";
import { SettingsSync, isRecord, type Raw } from "./settings-sync";
import type { Settings } from "./settings-types";
import { normaliseSettings } from "./settings-normalise";

/**
 * Where the settings live: the settings file shared by every window, a
 * local copy for a fast start, changes sent and received as other windows
 * make them (SettingsContext.tsx). The side effects of settings.
 */

export const STORAGE_KEY = "catvinci-settings";

/** The settings blob localStorage held before the move - still the store
 *  without Rust (the browser dev shim, vitest), and what the one-time
 *  import reads. Left in place after the import, so a downgrade to 0.9.6
 *  still finds it. */
export function readLocalSettings(): Raw | null {
  const parsed = readLocalJson(STORAGE_KEY);
  return isRecord(parsed) ? parsed : null;
}

export function writeLocalSettings(patch: Raw) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readLocalSettings(), ...patch }),
    );
  } catch {
    // Storage unavailable: the change holds for this session only.
  }
}

// ---------------------------------------------------------------------------
// The store. With Rust behind the page (src/storage/boot.ts), the settings
// live in settings.json, held by Rust: read here from the boot snapshot,
// changed by sending only the fields that changed, and kept in step with
// other windows through "settings-changed" (see settings-sync.ts for who
// wins when). Without it, localStorage, as before the move.
// ---------------------------------------------------------------------------

/** Mirrors SettingsChanged in src-tauri/src/settings.rs. */
export interface SettingsChanged {
  rev: number;
  patch: Raw;
  from: string;
}

export let sync: SettingsSync | null = null;
export let normalised: { raw: Raw; settings: Settings } | null = null;
export const remoteListeners = new Set<() => void>();

/** The file-backed store, set up on first use; null without Rust. */
export function fileStore(): SettingsSync | null {
  if (sync) return sync;
  const boot = readBoot();
  if (!boot) return null;

  if (boot.legacyImport) {
    // First launch since the move: Rust has nothing yet, localStorage has
    // everything. Use it right away and hand it over; Rust answers with
    // what it kept (another window may have got there first).
    const legacy = normaliseSettings(readLocalSettings()) as unknown as Raw;
    sync = new SettingsSync(legacy, boot.rev);
    void importLegacyStorage(legacy).then((result) => {
      if (result) adopt(result.value, result.rev);
    });
  } else {
    sync = new SettingsSync(boot.settings, boot.rev);
    // The snapshot is from when the window was built - a reload replays an
    // old one, and a change made meanwhile by another window was sent
    // before this page could hear it - so the live values replace it.
    const live =
      Object.keys(boot.settings).length === 0
        ? // Nothing stored (a corrupt settings.json was moved aside, or
          // one Rust can't read is being left alone): write the fresh
          // defaults out now, as a first launch always has, so the next
          // launch doesn't read a half-written file as an old install.
          // Only into fields still missing, though: reloaded later, this
          // window replays the same empty snapshot, and must not put the
          // defaults back over everything changed since.
          trackWrite(
            storage.settingsFillDefaults(
              normaliseSettings(null) as unknown as Raw,
            ),
          )
        : storage.settingsGet();
    live.then((s) => adopt(s.value, s.rev)).catch(() => {});
  }

  void listenToThisWindow<SettingsChanged>("settings-changed", (event) => {
    const { rev, patch, from } = event.payload;
    if (from === boot.label || !sync) return;
    // Zoom is each window's own (see its field comment): saved for the
    // next window to open with, never pushed into ones already open.
    const shared = { ...patch };
    delete shared.zoom;
    if (sync.remote(shared, rev)) notifyRemote();
  });
  return sync;
}

/** Adopts a full snapshot from Rust, keeping this window's zoom. */
export function adopt(value: Raw, rev: number) {
  if (!sync) return;
  const next = { ...value };
  if (sync.raw.zoom !== undefined) next.zoom = sync.raw.zoom;
  if (sync.snapshot(next, rev)) notifyRemote();
}

/** Counts the changes notifyRemote has announced, so a provider can tell
 *  whether one came between its first render and its subscription. */
export let remoteVersion = 0;

export function notifyRemote() {
  remoteVersion += 1;
  for (const fn of remoteListeners) fn();
}

export function send(ticket: Map<string, number>) {
  const store = sync;
  if (!store) return;
  const patch: Raw = {};
  for (const key of ticket.keys()) patch[key] = store.raw[key];
  trackWrite(storage.settingsPatch(patch)).then(
    (rev) => store.confirm(ticket, rev),
    () => store.confirm(ticket),
  );
}

/** Saves the fields in `patch` that differ from what's stored.
 *
 *  Every change goes to Rust at once, keystrokes in Custom CSS included:
 *  Rust holds it in memory, coalesces the disk writes (FLUSH_DELAY in
 *  settings.rs) and writes whatever is pending when the app exits. A
 *  debounce here lost the last keystrokes of a quick Cmd+Q, window close or
 *  Dock Quit on macOS: the window was gone before the timer fired, and a
 *  flush from pagehide didn't reach Rust either. The IPC is still
 *  asynchronous, so every close path the app owns waits for the patches
 *  on their way before the window is destroyed (send's trackWrite,
 *  storage/pending-writes.ts). */
export function persist(patch: Partial<Settings>) {
  const store = fileStore();
  if (!store) {
    writeLocalSettings(patch);
    return;
  }
  // A field not stored at all reads as its default, so setting it to the
  // default changes nothing either.
  const current = loadSettings() as unknown as Raw;
  const changed: Raw = {};
  for (const [key, value] of Object.entries(patch)) {
    if (JSON.stringify(current[key]) !== JSON.stringify(value))
      changed[key] = value;
  }
  if (Object.keys(changed).length === 0) return;
  send(store.local(changed));
}

/** Calls `fn` whenever another window (or a re-read) changes the settings.
 *  Returns the unsubscribe. */
export function subscribeRemote(fn: () => void): () => void {
  if (fileStore()) {
    remoteListeners.add(fn);
    return () => remoteListeners.delete(fn);
  }
  // Fallback: another window's write to the same localStorage key.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue !== null) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/** The current settings, outside React - exported so small standalone
 *  stores (chat-history.ts, clipboard-history.ts) can read a privacy
 *  toggle's current value without depending on context. Includes this
 *  window's latest changes, whether or not they've reached Rust yet. */
export function loadSettings(): Settings {
  const store = fileStore();
  // The fallback re-reads every time: other tabs write it too.
  if (!store) return normaliseSettings(readLocalSettings());
  if (normalised?.raw !== store.raw)
    normalised = { raw: store.raw, settings: normaliseSettings(store.raw) };
  return normalised.settings;
}

// Every request to an AI service asks the switch as it goes out - this
// window's latest value, so a request made right after turning Textus AI
// off is refused, and one made at launch goes by what was saved.
gateAiRequests(() => loadSettings().textusAi);

/** Forgets the store, for tests that install a different boot snapshot. */
export function resetSettingsStoreForTests(): void {
  sync = null;
  normalised = null;
  remoteListeners.clear();
}
