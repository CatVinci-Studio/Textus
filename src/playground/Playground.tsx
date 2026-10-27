import {
  type ChangeEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
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
import {
  IMPORT_EXTENSIONS,
  canOpenFiles,
  fileKind,
  pickMarkdownFiles,
  readMarkdownFile,
} from "./markdown-file";
import { documentName, useWebDocuments } from "./useWebDocuments";
import { ContextMenu } from "../ui/ContextMenu";
import { Presence } from "../ui/usePresence";
import { ChevronIcon } from "../ui/icons";
import sampleEn from "./samples/en.md?raw";
import sampleZh from "./samples/zh.md?raw";
import mark from "../../src-tauri/icons/128x128.png";

export const DOWNLOAD_URL = "https://textus.catvinci.com/#download";

const NOTICE_MS = 3200;

/** The first visit's document, in the UI language where there is one. */
function sample(lang: Lang): string {
  return lang === "zh" ? sampleZh : sampleEn;
}

/** What the page itself listens for: files dropped anywhere on it, Mod+/,
 *  and the tab going away. */
function usePageEvents(
  importFile: (file: File) => Promise<void>,
  toggleSource: () => void,
  save: () => void,
  editorRef: RefObject<EditorHandle | null>,
) {
  // Files dropped on the page: a document is imported, anything else
  // explained, never left to the browser to navigate to. Text dragged inside
  // the editor isn't a file drag.
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

  // Mod+/ switches to source mode and back, as in the app; Mod+S saves.
  const toggleRef = useRef(toggleSource);
  toggleRef.current = toggleSource;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = modIsMeta() ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey) return;
      if (e.key === "/") {
        e.preventDefault();
        toggleRef.current();
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
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
  }, [editorRef]);
}

/** A notice shown for a few seconds. */
function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice] as const;
}

/** Textus in a browser tab: documents kept in this browser, opened from
 *  and saved to files on disk. */
export function Playground({ settings }: { settings: Settings }) {
  const t = resolveStrings(settings.language);
  const docs = useWebDocuments(sample(settings.language), t.untitledTab);
  if (!docs.doc || !docs.docs) return null;
  return <WebEditor settings={settings} t={t} docs={docs} />;
}

function WebEditor({
  settings,
  t,
  docs,
}: {
  settings: Settings;
  t: ReturnType<typeof resolveStrings>;
  docs: ReturnType<typeof useWebDocuments>;
}) {
  const doc = docs.doc!;
  const [source, setSource] = useState(false);
  const [notice, setNotice] = useNotice();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onChange = (markdown: string) => docs.update(doc.id, markdown);

  /** The document as it stands, wherever it is being edited. */
  function currentMarkdown(): string {
    return (source ? null : editorRef.current?.markdown()) ?? doc.markdown;
  }

  function toggleSource() {
    if (source) {
      setPendingCaret(
        textareaRef.current ? readTextareaCaret(textareaRef.current) : null,
      );
    } else {
      const markdown = currentMarkdown();
      setPendingCaret(captureEditorCaret(markdown));
      onChange(markdown);
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
    docs.open([{ markdown: await readMarkdownFile(file), name: file.name }]);
  }

  async function openFiles() {
    if (!canOpenFiles()) {
      fileInputRef.current?.click();
      return;
    }
    const picked = await pickMarkdownFiles();
    if (!picked) return;
    docs.open(
      await Promise.all(
        picked.map(async ({ file, handle }) => ({
          markdown: await readMarkdownFile(file),
          name: file.name,
          handle,
        })),
      ),
    );
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    for (const file of files) void importFile(file);
  }

  async function save() {
    const markdown = currentMarkdown();
    onChange(markdown);
    const name = await docs.save(markdown).catch(() => null);
    if (name) setNotice(t.playgroundSavedTo.replace("{name}", name));
  }

  usePageEvents(importFile, toggleSource, () => void save(), editorRef);

  const items = [
    ...docs.docs!.map((d) => ({
      label: documentName(d, t.untitledTab),
      checked: d.id === doc.id,
      onSelect: () => docs.select(d.id),
    })),
    "separator" as const,
    { label: t.playgroundNewDocument, onSelect: docs.create },
    {
      label: t.playgroundDeleteDocument,
      onSelect: () => docs.remove(doc.id),
      danger: true,
    },
  ];

  return (
    <div className="playground">
      <header className="playground-bar">
        <div className="playground-brand">
          <img src={mark} alt="" width={22} height={22} />
          <span className="playground-name">{APP_NAME}</span>
          <span className="playground-tag">{t.playgroundName}</span>
        </div>
        <button
          type="button"
          className="text-button playground-documents"
          aria-haspopup="menu"
          aria-label={t.playgroundDocuments}
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setMenu({ x: box.left, y: box.bottom + 4 });
          }}
        >
          {documentName(doc, t.untitledTab)}
          <ChevronIcon className="playground-documents-chevron" />
        </button>
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
            onClick={() => void openFiles()}
          >
            {t.playgroundOpen}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => void save()}
          >
            {t.playgroundSave}
          </button>
          <a className="playground-download" href={DOWNLOAD_URL}>
            {t.playgroundDownload}
          </a>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept={[...IMPORT_EXTENSIONS, "text/markdown", "text/plain"].join(
            ",",
          )}
          onChange={onPick}
          data-testid="playground-import-input"
        />
      </header>
      <Presence show={menu !== null} exitMs={120}>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={items}
            onClose={() => setMenu(null)}
          />
        )}
      </Presence>
      {source ? (
        <SourceTextarea
          key={doc.id}
          ref={textareaRef}
          value={doc.markdown}
          typewriter={false}
          onChange={onChange}
        />
      ) : (
        <PlaygroundEditor
          key={doc.id}
          initialValue={doc.markdown}
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
