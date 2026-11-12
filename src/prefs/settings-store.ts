import { storage } from "../platform/ipc";
import { gateAiRequests } from "../platform/ai-gate";
import { readBoot } from "../storage/boot";
import { LOCAL_KEYS, readLocalJson, writeLocal } from "../storage/local";
import { trackWrite } from "../storage/pending-writes";
import { listenToThisWindow } from "../platform/events";
import { SettingsSync, isRecord, type Raw } from "./settings-sync";
import type { Settings } from "./settings-types";
import { normaliseSettings } from "./settings-normalise";

/** Where the settings live: the shared settings file, a local copy for a
 *  fast start, and changes to and from other windows. */

const STORAGE_KEY = LOCAL_KEYS.settings;

/** The settings blob in localStorage: the store without Rust (the browser
 *  dev shim, vitest). */
export function readLocalSettings(): Raw | null {
  const parsed = readLocalJson(STORAGE_KEY);
  return isRecord(parsed) ? parsed : null;
}

/** Storage unavailable, the change holds for this session only. */
export function writeLocalSettings(patch: Raw) {
  writeLocal(STORAGE_KEY, JSON.stringify({ ...readLocalSettings(), ...patch }));
}

// The store. With Rust behind the page, settings live in settings.json:
// read from the boot snapshot, changed by sending only changed fields, and
// synced across windows by "settings-changed". Without it, localStorage.

interface SettingsChanged {
  rev: number;
  patch: Raw;
  from: string;
}

let sync: SettingsSync | null = null;
let normalised: { raw: Raw; settings: Settings } | null = null;
const remoteListeners = new Set<() => void>();

/** The file-backed store, set up on first use; null without Rust. */
function fileStore(): SettingsSync | null {
  if (sync) return sync;
  const boot = readBoot();
  if (!boot) return null;

  // Nothing stored (a new profile, or an unreadable file set aside): a new
  // installation's defaults, written now so the next launch reads the same.
  const fresh = boot.newProfile || Object.keys(boot.settings).length === 0;
  const defaults: Raw = { ...normaliseSettings(null) };
  sync = new SettingsSync(
    fresh ? { ...defaults, ...boot.settings } : boot.settings,
    boot.rev,
  );
  // A reload replays an old snapshot, and another window may have changed
  // things meanwhile, so the live values replace it.
  const live = fresh
    ? // Only into fields still missing, though: reloaded later, this
      // window replays the same snapshot, and must not put the defaults
      // back over everything changed since.
      trackWrite(storage.settingsFillDefaults(defaults))
    : storage.settingsGet();
  live.then((s) => adopt(s.value, s.rev)).catch(() => {});

  void listenToThisWindow<SettingsChanged>("settings-changed", (event) => {
    const { rev, patch, from } = event.payload;
    if (from === boot.label || !sync) return;
    // A window's own fields: saved for the next window, never pushed to
    // open ones.
    const shared = { ...patch };
    for (const key of WINDOW_OWN) delete shared[key];
    if (sync.remote(shared, rev)) notifyRemote();
  });
  return sync;
}

/** Settings each window keeps its own: its zoom, and the folder its AI
 *  works in (each window works in the folder it opened). */
export const WINDOW_OWN = ["zoom", "agentWorkspaceRoot"] as const;

/** Adopts a full snapshot from Rust, keeping this window's own fields. */
function adopt(value: Raw, rev: number) {
  if (!sync) return;
  const next = { ...value };
  for (const key of WINDOW_OWN)
    if (sync.raw[key] !== undefined) next[key] = sync.raw[key];
  if (sync.snapshot(next, rev)) notifyRemote();
}

/** Counts the changes notifyRemote has announced, so a provider can tell
 *  whether one came between its first render and its subscription. */
export let remoteVersion = 0;

function notifyRemote() {
  remoteVersion += 1;
  for (const fn of remoteListeners) fn();
}

function send(ticket: Map<string, number>) {
  const store = sync;
  if (!store) return;
  const patch: Raw = {};
  for (const key of ticket.keys()) patch[key] = store.raw[key];
  trackWrite(storage.settingsPatch(patch)).then(
    (rev) => store.confirm(ticket, rev),
    () => store.confirm(ticket),
  );
}

/** Saves the fields in `patch` that differ from what's stored. Every change
 *  goes to Rust at once: Rust coalesces disk writes and flushes on exit, while
 *  a debounce here would lose the last keystrokes of a quick quit. */
export function persist(patch: Partial<Settings>) {
  const store = fileStore();
  if (!store) {
    writeLocalSettings(
      "formatBar" in patch ? { ...patch, formatBarOnce: true } : patch,
    );
    return;
  }
  // A field not stored at all reads as its default, so setting it to the
  // default changes nothing either.
  const current: Raw = { ...loadSettings() };
  const changed: Raw = {};
  for (const [key, value] of Object.entries(patch)) {
    if (JSON.stringify(current[key]) !== JSON.stringify(value))
      changed[key] = value;
  }
  if (Object.keys(changed).length === 0) return;
  // The format bar as the user leaves it is kept from now on: written with
  // the mark that says so, which a profile from before 1.3.13 lacks.
  if ("formatBar" in changed) changed.formatBarOnce = true;
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

/** The current settings, outside React, including this window's changes not
 *  yet in Rust. */
export function loadSettings(): Settings {
  const store = fileStore();
  // The fallback re-reads every time: other tabs write it too.
  if (!store) return normaliseSettings(readLocalSettings());
  if (normalised?.raw !== store.raw)
    normalised = { raw: store.raw, settings: normaliseSettings(store.raw) };
  return normalised.settings;
}

// Every AI request checks the switch as it goes out, so one made right after
// turning Textus AI off is refused.
gateAiRequests(() => loadSettings().textusAi);

/** Forgets the store, for tests that install a different boot snapshot. */
export function resetSettingsStoreForTests(): void {
  sync = null;
  normalised = null;
  remoteListeners.clear();
}
