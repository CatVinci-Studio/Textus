/**
 * The few APIs a dependency calls that the oldest supported engine lacks
 * (docs/dev/webview-support.md). Our own code checks for these instead;
 * this is for code we don't write. Installed at startup, before any
 * of it loads.
 *
 * - URL.canParse (Chromium 120): Mermaid's link sanitizer
 *   (@braintree/sanitize-url) calls it on every http(s) link in a
 *   diagram, which threw on WebView2 before 120.
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
