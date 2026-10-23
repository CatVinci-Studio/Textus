import { useEffect, useRef, useState } from "react";
import type { Strings } from "../../i18n/strings";
import { links, themeGallery } from "../../platform/ipc";
import {
  galleryStatus,
  installGalleryTheme,
  installedCopy,
  type GalleryStatus,
  type GalleryTheme,
} from "../../theme/theme-gallery";
import { withUserTheme } from "../../theme/theme-import";
import { errorText } from "../../utils/error-text";
import { useLatest } from "../../utils/hooks/useLatest";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "./controls";

/**
 * Settings › Extensions › Themes › Get themes (inside that group, which
 * ThemeLibrarySection draws): the public
 * theme gallery.
 * The catalog is fetched when this page opens and at no other time - the
 * app makes no gallery requests in the background. Installing a theme makes
 * it a user theme, as Import CSS… does, and selects it; an update replaces
 * the installed copy and leaves the selection as it is. Removing one is the
 * theme picker's Delete Theme.
 */
export function ThemeGallerySection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const latest = useLatest(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);
  const { catalog, unreachable, retry } = useGalleryCatalog();

  async function install(theme: GalleryTheme) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      const installed = installedCopy(theme, latest.current.userThemes);
      const meta = await installGalleryTheme(theme, installed);
      setSettings({
        userThemes: withUserTheme(latest.current.userThemes, meta),
        ...(installed ? {} : { themeId: meta.id }),
      });
    } catch (err) {
      setError(`${t.themeGalleryInstallFailed} ${errorText(err)}`);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  if (unreachable) {
    return (
      <div className="theme-gallery-message" role="status">
        <div className="settings-row-hint">{t.themeGalleryUnreachable}</div>
        <div className="theme-gallery-message-actions">
          <button
            type="button"
            className="text-button settings-inline-button"
            onClick={retry}
          >
            {t.themeGalleryRetry}
          </button>
          <button
            type="button"
            className="text-button settings-inline-button"
            onClick={() => void links.openAboutLink("themes")}
          >
            {t.themeGalleryWebsite}
          </button>
        </div>
      </div>
    );
  }
  if (!catalog) {
    return (
      <div className="theme-gallery-message settings-row-hint" role="status">
        {t.themeGalleryLoading}
      </div>
    );
  }
  return (
    <>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      <div className="settings-group-body">
        {catalog.length === 0 && <SettingRow label={t.themeGalleryEmpty} />}
        {catalog.map((theme) => {
          const installed = installedCopy(theme, settings.userThemes);
          return (
            <GalleryItem
              key={theme.id}
              t={t}
              theme={theme}
              status={galleryStatus(theme, installed)}
              inUse={!!installed && installed.id === settings.themeId}
              busy={busy}
              onInstall={() => void install(theme)}
              onUse={() => installed && setSettings({ themeId: installed.id })}
            />
          );
        })}
      </div>
    </>
  );
}

function GalleryItem({
  t,
  theme,
  status,
  inUse,
  busy,
  onInstall,
  onUse,
}: {
  t: Strings;
  theme: GalleryTheme;
  status: GalleryStatus;
  inUse: boolean;
  busy: boolean;
  onInstall: () => void;
  onUse: () => void;
}) {
  const byline = t.themeGalleryBy.replace("{author}", theme.author);
  return (
    // The hint is cut to two lines; the whole description is on hover.
    <div
      className="theme-gallery-item"
      aria-label={theme.name}
      role="group"
      title={theme.description}
    >
      <GalleryPreview path={theme.previews[0]} />
      <SettingRow
        label={theme.name}
        hint={
          theme.author ? `${byline} · ${theme.description}` : theme.description
        }
      >
        {status === "install" ? (
          <button
            type="button"
            className="text-button settings-inline-button"
            disabled={busy}
            onClick={onInstall}
          >
            {t.themeGalleryInstall}
          </button>
        ) : (
          <>
            {status === "update" ? (
              <button
                type="button"
                className="text-button settings-inline-button"
                disabled={busy}
                onClick={onInstall}
              >
                {t.themeGalleryUpdate}
              </button>
            ) : (
              <span className="settings-row-value">
                {inUse ? t.themeGalleryInUse : t.themeGalleryInstalled}
              </span>
            )}
            {!inUse && (
              <button
                type="button"
                className="text-button settings-inline-button"
                disabled={busy}
                onClick={onUse}
              >
                {t.themeGalleryUse}
              </button>
            )}
          </>
        )}
      </SettingRow>
    </div>
  );
}

/** Screenshots fetched at once, at most: a long catalog scrolled quickly
 *  shouldn't start a download per row. */
const MAX_PREVIEW_FETCHES = 3;
let previewFetches = 0;
const waitingFetches: (() => void)[] = [];

/** Runs `task` once one of the preview slots is free. A finished task hands
 *  its slot straight to the next waiting one, so the count never overshoots. */
async function inPreviewSlot<T>(task: () => Promise<T>): Promise<T> {
  if (previewFetches < MAX_PREVIEW_FETCHES) previewFetches++;
  else await new Promise<void>((resolve) => waitingFetches.push(resolve));
  try {
    return await task();
  } finally {
    const next = waitingFetches.shift();
    if (next) next();
    else previewFetches--;
  }
}

/** A theme's first screenshot, fetched through the backend as a `data:`
 *  URL once its row scrolls into view - only ever shown as an image. An
 *  empty frame until it arrives, or if it can't. */
function GalleryPreview({ path }: { path: string | undefined }) {
  const frame = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!path || !visible) return;
    let cancelled = false;
    inPreviewSlot(() =>
      // A row closed while it waited for a slot needs no download.
      cancelled ? Promise.resolve(null) : themeGallery.preview(path),
    )
      .then((url) => !cancelled && setSrc(url))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path, visible]);

  return (
    <div className="theme-gallery-preview" ref={frame}>
      {src && <img src={src} alt="" draggable={false} />}
    </div>
  );
}

/** The gallery's catalog, fetched as the page opens and again on `retry`;
 *  `unreachable` when the fetch failed. */
function useGalleryCatalog() {
  const [catalog, setCatalog] = useState<GalleryTheme[] | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    setUnreachable(false);
    themeGallery
      .catalog()
      .then((themes) => !cancelled && setCatalog(themes))
      .catch(() => !cancelled && setUnreachable(true));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { catalog, unreachable, retry: () => setAttempt((n) => n + 1) };
}
