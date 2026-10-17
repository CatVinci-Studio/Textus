import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { APP_NAME, resolveStrings, type Lang } from "../i18n/strings";
import type { Settings } from "../settings/SettingsContext";
import { SourceTextarea } from "../editor/modes/SourceTextarea";
import {
  applyTextareaCaret,
  captureEditorCaret,
  readTextareaCaret,
  setPendingCaret,
  takePendingCaret,
} from "../editor/modes/mode-switch";
import { modIsMeta } from "../platform/os";
import { type EditorHandle, PlaygroundEditor } from "./PlaygroundEditor";
import { loadDocument, saveDocument } from "./document-store";
import {
  IMPORT_EXTENSIONS,
  downloadMarkdown,
  exportFilename,
  fileKind,
  readMarkdownFile,
} from "./markdown-file";
import sampleEn from "./samples/en.md?raw";
import sampleZh from "./samples/zh.md?raw";
import mark from "../../src-tauri/icons/128x128.png";

export const DOWNLOAD_URL = "https://textus.catvinci.com/#download";

const NOTICE_MS = 3200;

/** The first visit's document, in the UI language where there is one. */
function sample(lang: Lang): string {
  return lang === "zh" ? sampleZh : sampleEn;
}

/**
 * Textus in a browser tab: the editor, Import, Export and nothing else.
 * One document, kept in this browser (document-store.ts).
 */
export function Playground({ settings }: { settings: Settings }) {
  const t = resolveStrings(settings.language);
  const [content, setContent] = useState(
    () => loadDocument() ?? sample(settings.language),
  );
  const [source, setSource] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function onChange(markdown: string) {
    setContent(markdown);
    saveDocument(markdown);
  }

  /** The document as it stands, wherever it is being edited. */
  function currentMarkdown(): string {
    return (source ? null : editorRef.current?.markdown()) ?? content;
  }

  function toggleSource() {
    if (source) {
      setPendingCaret(
        textareaRef.current ? readTextareaCaret(textareaRef.current) : null,
      );
    } else {
      const markdown = currentMarkdown();
      setPendingCaret(captureEditorCaret(markdown));
      setContent(markdown);
    }
    setSource(!source);
  }

  // The source view just mounted: put the caret where the editor had it.
  useEffect(() => {
    const caret = source ? takePendingCaret() : null;
    if (caret && textareaRef.current)
      applyTextareaCaret(textareaRef.current, caret);
  }, [source]);

  async function importFile(file: File) {
    const kind = fileKind(file);
    if (kind !== "markdown") {
      setNotice(
        kind === "image"
          ? t.playgroundImageNotice
          : t.playgroundImportUnsupported,
      );
      return;
    }
    const markdown = await readMarkdownFile(file);
    saveDocument(markdown);
    // In the editor, as an edit Undo takes back.
    if (!source && editorRef.current) editorRef.current.replace(markdown);
    else setContent(markdown);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void importFile(file);
  }

  function exportDocument() {
    const markdown = currentMarkdown();
    downloadMarkdown(markdown, exportFilename(markdown, t.untitledTab));
  }

  // Files dropped anywhere on the page: a document is imported, anything
  // else explained - and never left to the browser, which would navigate
  // away to show it. Dragging text inside the editor isn't a file drag.
  const importRef = useRef(importFile);
  importRef.current = importFile;
  useEffect(() => {
    const isFileDrag = (e: DragEvent) =>
      e.dataTransfer?.types.includes("Files") ?? false;
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer?.files[0];
      if (file) void importRef.current(file);
    };
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, []);

  // Mod+/ switches to source mode and back, as in the app.
  const toggleRef = useRef(toggleSource);
  toggleRef.current = toggleSource;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = modIsMeta() ? e.metaKey : e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && e.key === "/") {
        e.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // An edit the listener's debounce still holds, before the tab goes.
  useEffect(() => {
    const flush = () => editorRef.current?.flush();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="playground">
      <header className="playground-bar">
        <div className="playground-brand">
          <img src={mark} alt="" width={22} height={22} />
          <span className="playground-name">{APP_NAME}</span>
          <span className="playground-tag">{t.playgroundName}</span>
        </div>
        <p className="playground-note">{t.playgroundLocalNote}</p>
        <div className="playground-actions">
          <button
            type="button"
            className="text-button"
            aria-pressed={source}
            title={t.menuToggleSourceMode}
            onClick={toggleSource}
          >
            {t.playgroundSource}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => fileInputRef.current?.click()}
          >
            {t.playgroundImport}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={exportDocument}
          >
            {t.playgroundExport}
          </button>
          <a className="playground-download" href={DOWNLOAD_URL}>
            {t.playgroundDownload}
          </a>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept={[...IMPORT_EXTENSIONS, "text/markdown", "text/plain"].join(
            ",",
          )}
          onChange={onPick}
          data-testid="playground-import-input"
        />
      </header>
      {source ? (
        <SourceTextarea
          ref={textareaRef}
          value={content}
          typewriter={false}
          onChange={onChange}
        />
      ) : (
        <PlaygroundEditor
          initialValue={content}
          settings={settings}
          onChange={onChange}
          onImage={() => setNotice(t.playgroundImageNotice)}
          handleRef={editorRef}
        />
      )}
      {notice && (
        <div className="playground-notice floating-surface" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
