/** Shared OS detection for shortcut dispatch, labels, and native features. */
export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /mac/i.test(navigator.platform || navigator.userAgent)
  );
}

/**
 * Whether a shortcut's Mod key is Cmd: on a Mac, and on iOS devices with a
 * hardware keyboard. Decided as ProseMirror's keymap does, so both agree.
 */
export function modIsMeta(
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): boolean {
  return /Mac|iP(hone|[oa]d)/.test(platform ?? "");
}

/** Windows. `navigator.platform` is "Win32" even on 64-bit Windows; the UA
 *  check is the fallback for runtimes that stopped reporting platform. */
export function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /^win/i.test(navigator.platform ?? "") ||
    /windows/i.test(navigator.userAgent)
  );
}

/** Linux desktop builds. Android also reports "Linux", and so does an
 *  iPhone's or iPad's web view emulated on a Linux host (CI's e2e): both are
 *  excluded, as `platformName` names them. */
export function isLinuxPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /linux/i.test(navigator.platform ?? "") && isDesktop();
}

/** iOS and iPadOS. An iPad reports "MacIntel" like a Mac by default; the
 *  tell is the touch screen (`maxTouchPoints` is 0 on a Mac). */
export function isIOSPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? "";
  if (/^(iPhone|iPad|iPod)/.test(platform)) return true;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  return platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1;
}

/** Android, phone or tablet. */
export function isAndroidPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}

/** A desktop build: anything not iOS or Android (whose "Linux" must never
 *  read as desktop). The Rust side's `cfg(desktop)`. */
export function isDesktop(): boolean {
  if (typeof navigator === "undefined") return true;
  return !isIOSPlatform() && !isAndroidPlatform();
}

/** The WebKit engine (macOS, iOS, Linux's WebKitGTK) rather than Chromium
 *  (Windows' WebView2, Android's WebView), which also names AppleWebKit. */
export function isWebKitEngine(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
}
