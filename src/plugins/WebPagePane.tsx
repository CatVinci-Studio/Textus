import { useRef, useState } from "react";
import { links, webPages } from "../platform/ipc";
import { hasNativeWebPages } from "../platform/capabilities";
import type { Strings } from "../i18n/strings";
import { useNativeWebPage } from "./useNativeWebPage";

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
 * network for its host): the page under an address row. On macOS and
 * Windows the page is a native webview of its own laid over the tab
 * (useNativeWebPage) - every site opens there, with its own cookies, where
 * many refuse to be framed. On Linux and a phone it is a frame. Either way the page
 * keeps its own origin, which is never the app's: it reaches nothing of
 * the window's.
 */
export function WebPagePane({
  tabId,
  url,
  t,
}: {
  tabId: string;
  url: string;
  t: Strings;
}) {
  return hasNativeWebPages ? (
    <NativeWebPage tabId={tabId} url={url} t={t} />
  ) : (
    <FramedWebPage url={url} t={t} />
  );
}

/** The address typed in the bar, as a page's: https:// added when it has
 *  no scheme. Null for one that can't be shown. */
function typedUrl(address: string): string | null {
  return webPageUrl(
    /^[a-z]+:\/\//i.test(address) ? address : `https://${address}`,
  );
}

function NativeWebPage({
  tabId,
  url,
  t,
}: {
  tabId: string;
  url: string;
  t: Strings;
}) {
  const [shown, setShown] = useState(url);
  const [typed, setTyped] = useState(url);
  const holder = useRef<HTMLDivElement>(null);
  useNativeWebPage(tabId, url, holder, (address) => {
    setShown(address);
    setTyped(address);
  });
  return (
    <div className="web-page-pane">
      <AddressBar
        typed={typed}
        onType={setTyped}
        onGo={(address) => {
          const next = typedUrl(address);
          if (!next) return;
          setTyped(next);
          setShown(next);
          void webPages.navigate(tabId, next).catch(() => {});
        }}
        onReload={() => void webPages.reload(tabId).catch(() => {})}
        onOutside={() => void links.openWebLink(shown)}
        t={t}
      />
      <div ref={holder} className="web-page-native" />
    </div>
  );
}

function AddressBar({
  typed,
  onType,
  onGo,
  onReload,
  onOutside,
  t,
}: {
  typed: string;
  onType: (address: string) => void;
  onGo: (address: string) => void;
  onReload: () => void;
  onOutside: () => void;
  t: Strings;
}) {
  return (
    <form
      className="web-page-bar"
      onSubmit={(e) => {
        e.preventDefault();
        onGo(typed.trim());
      }}
    >
      <input
        className="web-page-address"
        aria-label={t.webPageAddress}
        value={typed}
        spellCheck={false}
        onChange={(e) => onType(e.target.value)}
      />
      <button type="button" onClick={onReload}>
        {t.webPageReload}
      </button>
      <button type="button" onClick={onOutside}>
        {t.webPageOpenInBrowser}
      </button>
    </form>
  );
}

/** The page as a frame, where there are no native pages (Linux, a phone). */
function FramedWebPage({ url, t }: { url: string; t: Strings }) {
  const [shown, setShown] = useState(url);
  const [typed, setTyped] = useState(url);
  const frameRef = useRef<HTMLIFrameElement>(null);
  return (
    <div className="web-page-pane">
      <AddressBar
        typed={typed}
        onType={setTyped}
        onGo={(address) => {
          const next = typedUrl(address);
          if (!next) return;
          setTyped(next);
          setShown(next);
        }}
        onReload={() => {
          if (frameRef.current) frameRef.current.src = shown;
        }}
        onOutside={() => void links.openWebLink(shown)}
        t={t}
      />
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
