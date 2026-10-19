/**
 * The app's icon set - one house style, drawn once.
 *
 * All of them are stroked line art on a 16-unit grid, sized in the 10-15px
 * range, and coloured with `currentColor` so an icon takes the colour and
 * opacity of whatever it sits in. That last part is why these exist at all:
 * the UI used to reach for emoji (📄, 🖼, 🔍, 📎, 📌) and typographic marks
 * (✕, ⧉, ▾) wherever the sidebar's set didn't reach. Emoji render at the
 * system's own size and in full colour, so they read as stickers dropped
 * into 11px muted chrome and look different on every platform; ✕ and ⧉ in
 * particular vary enough in metrics between fonts to shift a toolbar's
 * alignment. Neither can be styled - a disabled or accented icon still
 * arrives at full saturation.
 *
 * Add new icons here rather than inline, and keep to the same grid and
 * stroke weight, or the set stops being a set.
 */
type IconProps = { className?: string };

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
    >
      <path
        d="M3 1.5L7 5L3 8.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The folder outline, drawn once: FolderIcon fills it, TreeTabIcon strokes
 *  it. Two copies of the path drifted apart the moment either was nudged. */
const FOLDER_PATH =
  "M1.5 3.5C1.5 2.94772 1.94772 2.5 2.5 2.5H6L7.5 4H13.5C14.0523 4 14.5 4.44772 14.5 5V11.5C14.5 12.0523 14.0523 12.5 13.5 12.5H2.5C1.94772 12.5 1.5 12.0523 1.5 11.5V3.5Z";

export function FolderIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path d={FOLDER_PATH} fill="currentColor" opacity="0.75" />
    </svg>
  );
}

export function FolderOpenIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M1.5 3.5C1.5 2.94772 1.94772 2.5 2.5 2.5H6L7.5 4H13V5H2.2L1.5 3.5Z"
        fill="currentColor"
        opacity="0.75"
      />
      <path
        d="M1.2 6H14.3C14.7 6 15 6.37 14.9 6.76L13.5 12.1C13.4 12.4 13.1 12.6 12.8 12.6H2.2C1.9 12.6 1.6 12.4 1.5 12.1L0.9 6.76C0.85 6.37 1.15 6 1.55 6H1.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function MarkdownFileIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect
        x="1.5"
        y="2"
        width="13"
        height="12"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M4 10.5V5.5L6.3 8L8.6 5.5V10.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 5.5V10.5M10.5 10.5L9 8.8M10.5 10.5L12 8.8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ImageFileIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect
        x="1.5"
        y="2"
        width="13"
        height="12"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <circle cx="5.3" cy="5.8" r="1.1" fill="currentColor" />
      <path
        d="M2.5 11.5L6 8L8.5 10.2L10.8 7.5L13.5 11"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GenericFileIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M3.5 2C3.5 1.72386 3.72386 1.5 4 1.5H9L12.5 5V13.5C12.5 13.7761 12.2761 14 12 14H4C3.72386 14 3.5 13.7761 3.5 13.5V2Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M9 1.5V5H12.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TreeTabIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d={FOLDER_PATH}
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OutlineTabIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
    >
      <circle cx="2.3" cy="3.5" r="1" fill="currentColor" />
      <path
        d="M5.2 3.5H14"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="4" cy="8" r="1" fill="currentColor" />
      <path
        d="M6.9 8H14"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="4" cy="12.5" r="1" fill="currentColor" />
      <path
        d="M6.9 12.5H14"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ClipboardTabIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect
        x="3"
        y="2.8"
        width="10"
        height="11.5"
        rx="1.3"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <rect
        x="5.5"
        y="1.5"
        width="5"
        height="2.4"
        rx="0.8"
        fill="currentColor"
      />
      <path
        d="M5.5 7.5H10.5M5.5 10.5H10.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChatTabIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M2 3.8C2 3.02 2.63 2.4 3.4 2.4H12.6C13.37 2.4 14 3.02 14 3.8V9.4C14 10.17 13.37 10.8 12.6 10.8H6.4L3.6 13.2V10.8H3.4C2.63 10.8 2 10.17 2 9.4V3.8Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Textus AI itself: a four-pointed spark, with a small one beside it (the
 *  AI panel's empty state). */
export function SparkleIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M7 2.5C7.35 5.1 8.4 6.15 11 6.5C8.4 6.85 7.35 7.9 7 10.5C6.65 7.9 5.6 6.85 3 6.5C5.6 6.15 6.65 5.1 7 2.5Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M11.75 10C11.9 11.1 12.4 11.6 13.5 11.75C12.4 11.9 11.9 12.4 11.75 13.5C11.6 12.4 11.1 11.9 10 11.75C11.1 11.6 11.6 11.1 11.75 10Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "More actions" on a row (the iPhone document list). */
export function MoreIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.5" cy="8" r="1.3" />
    </svg>
  );
}

/** Dismiss/close, everywhere: tab close, panel close, chip remove. */
export function CloseIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M4 4L12 12M12 4L4 12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Pop out into a separate window (Quick Ask's ⧉, clipboard history). */
export function DetachIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M7 2.5H3.5C2.95 2.5 2.5 2.95 2.5 3.5V12.5C2.5 13.05 2.95 13.5 3.5 13.5H12.5C13.05 13.5 13.5 13.05 13.5 12.5V9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.8 2.5H13.5V6.2M13.5 2.5L8.2 7.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Copy to clipboard. Distinct from DetachIcon, which the clipboard history
 *  used to borrow (⧉) even though it copies rather than opens anything. */
export function CopyIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect
        x="5.5"
        y="5.5"
        width="8"
        height="8"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M10.5 5.5V3.7C10.5 3.03 9.97 2.5 9.3 2.5H3.7C3.03 2.5 2.5 3.03 2.5 3.7V9.3C2.5 9.97 3.03 10.5 3.7 10.5H5.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Keep the detached chat window above the editor. */
export function PinIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M10.4 2.2 13.8 5.6M10.9 3.1 8.6 5.4l-3.5.8 5.2 5.2.8-3.5 2.3-2.3M6.6 9.4 2.8 13.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Add - the chat composer's attach-file button, and the table row/column
 *  insert handles. */
export function PlusIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d={PLUS_PATH}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const PLUS_PATH = "M8 3.5V12.5M3.5 8H12.5";

/** The same plus as markup, for the parts of the editor that build their DOM
 *  imperatively (ProseMirror node views) and can't render a component. Kept
 *  here so those buttons stay part of the set instead of drifting back to a
 *  "+" character with its own font metrics. */
export const PLUS_ICON_HTML =
  `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">` +
  `<path d="${PLUS_PATH}" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>` +
  `</svg>`;

/** The agent's search_document tool call. */
export function SearchIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <circle cx="7" cy="7" r="4.3" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M10.2 10.2L13.5 13.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A file the agent read, or one attached to a message. */
export function PaperclipIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M12.4 7.3 7.5 12.2a3 3 0 0 1-4.3-4.3l5.5-5.5a2 2 0 0 1 2.9 2.9L6 10.9a1 1 0 0 1-1.4-1.4l4.6-4.6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Confirmation on a button that just did something ("Cleared"). */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M3.2 8.4L6.4 11.6L12.8 4.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Step to the previous/next match in Find & Replace. One icon, flipped by
 *  the caller with a CSS rotate - two hand-drawn mirror images drift. */
export function ArrowUpIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M8 12.5V3.5M8 3.5L4.5 7M8 3.5L11.5 7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Re-read a listing from disk (the file tree). */
export function RefreshIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M13 8a5 5 0 1 1-1.46-3.54M13 3v3h-3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* The window caption, drawn only where the app owns the frame - Windows, see
   platform/window-chrome.ts. These four deliberately break the 16-unit stroked
   grid the rest of the set keeps to: Windows caption glyphs are a fixed
   10x10 hairline shape that every other app on the desktop draws the same
   way, and a rounder, heavier "house style" close button next to the
   system's own would read as the wrong control rather than as ours. */

/** The way into the app menu, once the native menu bar is gone. */
export function HamburgerIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
    >
      <path
        d="M1.5 3h9M1.5 6h9M1.5 9h9"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function WindowMinimizeIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
    >
      <path d="M1 5h8" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function WindowMaximizeIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
    >
      <rect
        x="1.5"
        y="1.5"
        width="7"
        height="7"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

/** Maximized state: the two offset squares Windows uses for "restore down". */
export function WindowRestoreIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
    >
      <path
        d="M3 3V1.5h5.5V7H7"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <rect
        x="1.5"
        y="3.5"
        width="5.5"
        height="5"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

export function WindowCloseIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
    >
      <path
        d="M1.5 1.5l7 7M8.5 1.5l-7 7"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"]);

/** A picture file, by its extension. */
export function isImageName(name: string): boolean {
  return IMAGE_EXTS.has(name.split(".").pop()?.toLowerCase() ?? "");
}

export function fileIconFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "markdown") return MarkdownFileIcon;
  if (IMAGE_EXTS.has(ext)) return ImageFileIcon;
  return GenericFileIcon;
}

/** Undo (the iPhone keyboard toolbar). */
export function UndoIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M5.5 3.5L2.5 6.5L5.5 9.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 6.5H9.75C11.82 6.5 13.5 8.18 13.5 10.25C13.5 12.32 11.82 14 9.75 14H7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Paste: a clipboard with a sheet on it. */
export function PasteIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M10.5 2.8H12C12.72 2.8 13.3 3.38 13.3 4.1V13.2C13.3 13.92 12.72 14.5 12 14.5H4C3.28 14.5 2.7 13.92 2.7 13.2V4.1C2.7 3.38 3.28 2.8 4 2.8H5.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <rect
        x="5.5"
        y="1.5"
        width="5"
        height="2.6"
        rx="0.8"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M5.5 8H10.5M5.5 11H9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Bullet list: three dots, three lines. */
export function BulletListIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <circle cx="3" cy="4" r="1.1" fill="currentColor" />
      <circle cx="3" cy="8" r="1.1" fill="currentColor" />
      <circle cx="3" cy="12" r="1.1" fill="currentColor" />
      <path
        d="M6 4H14M6 8H14M6 12H14"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Numbered list: 1, 2, 3 beside three lines. */
export function NumberedListIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M2 2.6L3.1 2V6M2.2 6H4M2.1 8.6C2.3 8.1 2.7 7.9 3.1 7.9C3.6 7.9 4 8.2 4 8.7C4 9.5 2.1 10.4 2.1 11.3H4.1"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 4H14M6.5 8H14M6.5 12H14"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The table edits (the iPhone keyboard toolbar): a two-by-two grid - or
 *  one row or column of it - with a plus on the side the new row or column
 *  goes, or a cross for a delete. */
const TABLE_EDIT_ICONS = {
  "row-above": { grid: [2.5, 6.5, 11, 8], mark: "M8 1V5M6 3H10" },
  "row-below": { grid: [2.5, 1.5, 11, 8], mark: "M8 11V15M6 13H10" },
  "column-left": { grid: [6.5, 2.5, 8, 11], mark: "M3 6V10M1 8H5" },
  "column-right": { grid: [1.5, 2.5, 8, 11], mark: "M13 6V10M11 8H15" },
  "delete-row": {
    grid: [1.5, 5, 9, 6],
    mark: "M11.5 6.5L14.5 9.5M14.5 6.5L11.5 9.5",
  },
  "delete-column": {
    grid: [5, 1.5, 6, 9],
    mark: "M6.5 11.5L9.5 14.5M9.5 11.5L6.5 14.5",
  },
  "delete-table": {
    grid: [1.5, 1.5, 9.5, 9.5],
    mark: "M11.8 11.8L14.8 14.8M14.8 11.8L11.8 14.8",
  },
} as const;

export function TableEditIcon({
  kind,
  className,
}: IconProps & { kind: keyof typeof TABLE_EDIT_ICONS }) {
  const { grid, mark } = TABLE_EDIT_ICONS[kind];
  const [x, y, w, h] = grid;
  // A single row or column is split only across its length.
  const across = !kind.startsWith("delete-") || kind === "delete-table";
  const lines = [
    w >= h || across ? `M${x + w / 2} ${y}V${y + h}` : "",
    h >= w || across ? `M${x} ${y + h / 2}H${x + w}` : "",
  ].join("");
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="1"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d={lines} stroke="currentColor" strokeWidth="1" />
      <path
        d={mark}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Delete: a bin. */
export function TrashIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M2.5 4H13.5M6 4V2.5H10V4M4 4L4.7 13.5H11.3L12 4M6.7 6.5V11M9.3 6.5V11"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Documents list: show as a grid of page thumbnails. */
export function GridViewIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}

/** Documents list: show as rows. */
export function ListViewIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    >
      <path d="M2.5 4H13.5M2.5 8H13.5M2.5 12H13.5" />
    </svg>
  );
}
