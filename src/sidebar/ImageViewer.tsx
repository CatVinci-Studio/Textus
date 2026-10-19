import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSettings } from "../settings/SettingsContext";
import { exportDoc } from "../platform/ipc";
import { canRevealInFileManager } from "../platform/capabilities";
import { basename, dirname } from "../utils/path";
import { INSERT_CLIPBOARD_TEXT_EVENT } from "../utils/events";
import { ChevronIcon, CloseIcon } from "../ui/icons";

/** How the document at `docPath` writes the picture at `path`: relative
 *  when it is under the document's folder (Typora's assets/...), else the
 *  full path - encoded where markdown would break. */
export function imageSrcFor(path: string, docPath: string | null): string {
  const dir = docPath ? dirname(docPath) : null;
  const src =
    dir && path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path;
  return src
    .replace(/%/g, "%25")
    .replace(/ /g, "%20")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E");
}

/**
 * A picture from the files sidebar, on its own: over the window, fitted to
 * it (a click shows it at its own size), with its name and size, ←/→ to
 * the folder's other pictures, and what can be done with it - put it in the
 * document at the cursor, or show it in the file manager. Esc, the × or a
 * click beside it closes.
 */
export function ImageViewer({
  paths,
  start,
  docPath,
  onClose,
}: {
  /** The folder's pictures, in the tree's order. */
  paths: string[];
  start: number;
  /** The document in front: an inserted picture is written relative to it. */
  docPath: string | null;
  onClose: () => void;
}) {
  const { t, settings } = useSettings();
  const zh = settings.language.startsWith("zh");
  const [at, setAt] = useState(start);
  const [actual, setActual] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const path = paths[at];
  const many = paths.length > 1;
  const go = (step: number) => {
    if (!many) return;
    setAt((i) => (i + step + paths.length) % paths.length);
  };

  useEffect(() => {
    setActual(false);
    setSize(null);
    setFailed(false);
  }, [path]);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => back?.focus?.();
  }, []);
  const latest = useRef({ go, onClose });
  latest.current = { go, onClose };
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        latest.current.onClose();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        latest.current.go(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        latest.current.go(1);
      }
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, []);

  const insert = () => {
    const name = basename(path).replace(/\.[^.]+$/, "");
    window.dispatchEvent(
      new CustomEvent(INSERT_CLIPBOARD_TEXT_EVENT, {
        detail: `![${name}](${imageSrcFor(path, docPath)})`,
      }),
    );
    onClose();
  };
  const ext = path.split(".").pop()?.toUpperCase() ?? "";

  return createPortal(
    <div
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={basename(path)}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="image-viewer-bar">
        <div className="image-viewer-title">
          <strong title={path}>{basename(path)}</strong>
          <span>
            {[
              ext,
              size ? `${size.w} × ${size.h}` : null,
              many ? `${at + 1} / ${paths.length}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <div className="image-viewer-actions">
          <button type="button" className="is-primary" onClick={insert}>
            {zh ? "插入到文档" : "Insert into document"}
          </button>
          {canRevealInFileManager && (
            <button
              type="button"
              onClick={() => void exportDoc.revealInDir(path).catch(() => {})}
            >
              {t.projectReveal}
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            className="image-viewer-close"
            aria-label={zh ? "关闭" : "Close"}
            title={zh ? "关闭 (Esc)" : "Close (Esc)"}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
      </header>
      <div
        className={`image-viewer-stage${actual ? " is-actual" : ""}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {failed ? (
          <p className="image-viewer-failed">
            {zh ? "无法显示这张图片。" : "This picture can't be shown."}
          </p>
        ) : (
          <img
            key={path}
            src={convertFileSrc(path)}
            alt={basename(path)}
            draggable={false}
            title={
              actual
                ? zh
                  ? "点击适应窗口"
                  : "Click to fit"
                : zh
                  ? "点击查看原始大小"
                  : "Click for actual size"
            }
            onLoad={(event) =>
              setSize({
                w: event.currentTarget.naturalWidth,
                h: event.currentTarget.naturalHeight,
              })
            }
            onError={() => setFailed(true)}
            onClick={() => setActual((on) => !on)}
          />
        )}
      </div>
      {many && (
        <>
          <button
            type="button"
            className="image-viewer-nav is-prev"
            aria-label={zh ? "上一张" : "Previous"}
            onClick={() => go(-1)}
          >
            <ChevronIcon />
          </button>
          <button
            type="button"
            className="image-viewer-nav is-next"
            aria-label={zh ? "下一张" : "Next"}
            onClick={() => go(1)}
          >
            <ChevronIcon />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
