/** `address` if a web page may be shown in a tab: HTTPS, and never the app's
 *  own origin, which the frame would then have. */
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
