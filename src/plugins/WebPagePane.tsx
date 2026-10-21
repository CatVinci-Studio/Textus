import { useRef, useState } from "react";
import { links } from "../platform/ipc";
import type { Strings } from "../i18n/strings";

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

/**
 * A web page in a tab (textus.window.openWebPage, for a plugin granted the
 * network for its host): a frame of the page with an address row. Not a
 * plugin's webview - one nested in that sandbox would have no cookies or
 * storage of its own, and most sites stop working without them. Here the
 * page keeps its own origin, which is never the app's: it can't reach the
 * window, and the window shows it as any browser frame would.
 */
export function WebPagePane({ url, t }: { url: string; t: Strings }) {
  const [shown, setShown] = useState(url);
  const [typed, setTyped] = useState(url);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const go = (address: string) => {
    const next = webPageUrl(/^[a-z]+:\/\//i.test(address) ? address : `https://${address}`);
    if (!next) return;
    setTyped(next);
    setShown(next);
  };
  return (
    <div className="web-page-pane">
      <form
        className="web-page-bar"
        onSubmit={(e) => {
          e.preventDefault();
          go(typed.trim());
        }}
      >
        <input
          className="web-page-address"
          aria-label={t.webPageAddress}
          value={typed}
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            if (frameRef.current) frameRef.current.src = shown;
          }}
        >
          {t.webPageReload}
        </button>
        <button type="button" onClick={() => void links.openWebLink(shown)}>
          {t.webPageOpenInBrowser}
        </button>
      </form>
      <p className="web-page-hint">{t.webPageHint}</p>
      <iframe
        ref={frameRef}
        className="web-page-frame"
        title={shown}
        src={shown}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
