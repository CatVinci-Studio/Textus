/**
 * APIs a dependency calls that the oldest supported engine lacks; our own code
 * checks instead. Installed at startup, before any of it loads.
 *
 * - URL.canParse (Chromium 120): Mermaid's link sanitizer calls it.
 */
export function installPolyfills(): void {
  if (typeof URL.canParse !== "function") {
    URL.canParse = (url: string | URL, base?: string | URL) => {
      try {
        new URL(url, base);
        return true;
      } catch {
        return false;
      }
    };
  }
}
