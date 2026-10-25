/** `address` if a web page may be shown in a tab: HTTPS, and never the
 *  app's own origin - the frame keeps its page's origin, and the app's
 *  would be the app. */
export function webPageUrl(address: string): string | null {
  try {
    const url = new URL(address);
    if (url.protocol !== "https:") return null;
    if (url.origin === window.location.origin) return null;
    return url.href;
  } catch {
    return null;
  }
}
