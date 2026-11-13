import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { currentStrings } from "../../i18n/current";
import { dataUrl, readPluginFile } from "../../plugins/store/files";
import { plugins as pluginsIpc } from "../../platform/ipc";
import type { PluginManifest } from "../../plugins/store/manifest";
import type { PluginOrigin } from "../../plugins/store/files";
import { catalogReadme, installedReadme } from "../../plugins/store/readme";

/**
 * A plugin's icon on a rounded tile, the same size whatever the artwork:
 * from the catalog before it is installed (`url` says it has one), from
 * its files after.
 * Without one, the first letter of its name.
 */
export function PluginIcon({
  id,
  manifest,
  url,
  origin,
  large = false,
}: {
  id: string;
  manifest: PluginManifest | null;
  url?: string;
  /** Installed: read from its own files. */
  origin?: PluginOrigin;
  large?: boolean;
}) {
  const file = manifest?.icon;
  const [read, setRead] = useState<string | null>(() =>
    url ? (catalogIcons.get(id) ?? null) : null,
  );
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let live = true;
    const shown = (src: string | null) => live && src && setRead(src);
    if (url) catalogIcon(id).then(shown, () => {});
    else if (origin && file)
      readPluginFile(id, origin, file)
        .then((bytes) => shown(dataUrl(file, bytes)))
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, origin, file, url]);
  const src = broken ? null : read;
  // From the id, which is Latin in every language: a name's first character
  // could be one of its script's (函 for 函数图像).
  const letter = (id.split(".")[1] ?? id).charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`plugin-icon${large ? " plugin-icon-large" : ""}`}
      aria-hidden="true"
    >
      {src && inTextColour(src) ? (
        <span
          className="plugin-icon-mask"
          style={{
            maskImage: `url("${src}")`,
            WebkitMaskImage: `url("${src}")`,
          }}
        />
      ) : src ? (
        <img src={src} alt="" onError={() => setBroken(true)} />
      ) : (
        <span className="plugin-icon-letter">{letter}</span>
      )}
    </span>
  );
}

/** An SVG drawn in `currentColor`: as an <img> it can't take the text's
 *  colour and draws black on a dark theme, so it is drawn as a mask. */
function inTextColour(src: string): boolean {
  const svg = /^data:image\/svg\+xml;base64,(.*)$/.exec(src);
  if (!svg) return false;
  try {
    return atob(svg[1]).includes("currentColor");
  } catch {
    return false;
  }
}

/** Catalog icons by plugin id, fetched once a session: through Rust, since
 *  GitHub serves them as application/octet-stream, which an <img> won't
 *  draw as an SVG. */
const catalogIcons = new Map<string, string>();

function catalogIcon(id: string): Promise<string | null> {
  const kept = catalogIcons.get(id);
  if (kept) return Promise.resolve(kept);
  return pluginsIpc.catalogIcon(id).then((src) => {
    if (src) catalogIcons.set(id, src);
    return src;
  });
}

// Drawn by the editor, as documents are, only once a README shows: a list
// of plugins has none.
const EditorPreview = lazy(() =>
  import("../../editor/EditorPreview").then((m) => ({
    default: m.EditorPreview,
  })),
);

/** Plugin `id`'s README - its own once installed, the catalog's before -
 *  its first heading left out (the page has the plugin's name above it);
 *  nothing until it is there, or without one. Installed, only its start
 *  shows until asked for the rest, so the groups below stay in reach. */
export function PluginReadme({
  id,
  installed,
  label,
}: {
  id: string;
  installed: boolean;
  label: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setText(null);
    void (installed ? installedReadme(id) : catalogReadme(id)).then(
      (t) => live && setText(t),
    );
    return () => {
      live = false;
    };
  }, [id, installed]);
  // Long is what the fold cuts: measured as the preview draws.
  useEffect(() => {
    const body = bodyRef.current;
    if (!installed || !body) return;
    const measure = () =>
      setLong(open || body.scrollHeight > body.clientHeight + 1);
    const watch = new ResizeObserver(measure);
    watch.observe(body);
    if (body.firstElementChild) watch.observe(body.firstElementChild);
    measure();
    return () => watch.disconnect();
  }, [installed, open, text]);
  if (!text?.trim()) return null;
  const t = currentStrings();
  return (
    <section
      className="plugin-readme"
      aria-label={label}
      data-folded={installed && !open ? "" : undefined}
    >
      <div className="plugin-readme-body" ref={bodyRef}>
        <Suspense fallback={null}>
          <EditorPreview
            markdown={text.replace(/^\s*#\s[^\n]*\n/, "")}
            docPath={null}
            label={label}
          />
        </Suspense>
      </div>
      {long && (
        <button
          type="button"
          className="text-button plugin-readme-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? t.chatAgentShowLess : t.chatAgentShowAll}
        </button>
      )}
    </section>
  );
}
