/**
 * The app's icon set: stroked line art on a 16-unit grid, coloured with
 * `currentColor` so an icon takes its surroundings' colour, unlike emoji.
 * Add new icons here, on the same grid and stroke weight.
 */
import { useId } from "react";

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

/** The folder outline, drawn once: FolderIcon fills it, TreeTabIcon strokes it. */
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

/** File > Open Folder…: the folder outline with a plus in it. */
export function OpenFolderIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d={FOLDER_PATH}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M8 6.5V10.5M6 8.5H10"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
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

const IMAGE_PICTURE_PATH = "M2.5 11.5L6 8L8.5 10.2L10.8 7.5L13.5 11";

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
        d={IMAGE_PICTURE_PATH}
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** ImageFileIcon as markup, for a missing image's card built by a node view. */
export const IMAGE_ICON_HTML =
  `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">` +
  `<rect x="1.5" y="2" width="13" height="12" rx="1.5" stroke="currentColor" stroke-width="1.1"/>` +
  `<circle cx="5.3" cy="5.8" r="1.1" fill="currentColor"/>` +
  `<path d="${IMAGE_PICTURE_PATH}" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>` +
  `</svg>`;

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

/** The window bar's sidebar toggle: a window with its left pane drawn. */
export function SidebarToggleIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect
        x="1.8"
        y="2.8"
        width="12.4"
        height="10.4"
        rx="2.2"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path d="M6.2 3.1v9.8" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

/** A read-only document's padlock, in the line weight of the bar's icons. */
export function LockIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
    >
      <rect
        x="3.2"
        y="7"
        width="9.6"
        height="7"
        rx="1.6"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

/** Textus AI's own button: the app icon's quill as a silhouette, struck
 *  through while Textus AI is off. Filled and a pixel larger than the rest:
 *  it is the product's mark. The strike is cut out, so it reads on any background. */
export function AssistantIcon({
  className,
  off = false,
}: IconProps & { off?: boolean }) {
  const cut = useId();
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      {off && (
        <mask id={cut} maskUnits="userSpaceOnUse">
          <rect width="16" height="16" fill="white" />
          <path
            d={STRIKE}
            stroke="black"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </mask>
      )}
      <g mask={off ? `url(#${cut})` : undefined}>
        <path
          d={QUILL}
          fill="currentColor"
          transform="translate(0 16) scale(0.0028571 -0.0028571)"
        />
      </g>
      {off && (
        <path
          d={STRIKE}
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/** The quill, in potrace's units: 5600 to the icon's 16, y upwards. */
const QUILL =
  "M4187 4823 c-3 -5 -4 -38 -4 -75 2 -151 -125 -305 -353 -431 -25 -13 -99 -52 -165 -86 -66 -34 -127 -68 -135 -75 -8 -8 -29 -21 -47 -30 -17 -8 -69 -51 -115 -95 -62 -58 -90 -79 -104 -75 -43 11 -316 -159 -470 -293 -79 -69 -224 -228 -233 -256 -2 -7 -17 -31 -33 -55 -16 -23 -34 -56 -40 -72 -8 -24 -14 -29 -31 -25 -38 10 -258 -188 -366 -329 -48 -62 -121 -198 -121 -225 0 -10 -4 -21 -9 -26 -38 -39 -38 -343 0 -437 19 -46 6 -69 -15 -28 -25 48 -76 100 -98 100 -31 0 -31 -27 0 -82 88 -154 61 -446 -49 -549 -20 -18 -29 -37 -29 -57 0 -17 -6 -37 -12 -44 -7 -7 -26 -33 -43 -57 -16 -24 -69 -81 -118 -127 -89 -83 -89 -83 -97 -146 -12 -99 -45 -235 -80 -333 -44 -126 -44 -123 -30 -140 21 -25 32 -18 105 67 105 124 164 178 313 292 58 44 63 51 58 78 -16 82 39 262 98 321 18 18 26 37 26 60 0 28 13 47 77 116 141 152 243 207 458 245 189 34 354 119 438 225 43 54 -9 84 -63 36 -14 -12 -75 -33 -160 -55 -19 -5 -78 -12 -130 -15 -52 -3 -104 -8 -115 -11 -15 -4 -14 -1 5 10 42 26 209 75 320 95 181 32 253 57 409 142 110 60 253 232 362 437 42 79 43 83 26 97 -11 7 -24 12 -30 9 -11 -4 -66 -75 -77 -99 -20 -44 -241 -258 -320 -310 -136 -90 -232 -130 -505 -211 -88 -26 -235 -82 -245 -93 -9 -11 -68 -41 -80 -41 -34 0 112 160 208 226 28 20 52 43 52 51 0 20 -25 26 -50 13 -53 -29 -25 13 86 124 39 39 82 79 95 88 13 10 35 26 49 36 113 85 279 145 540 197 139 27 262 60 310 81 251 113 375 239 445 456 31 95 30 142 -2 146 -18 3 -27 -8 -53 -64 -81 -176 -320 -367 -530 -425 -25 -7 -49 -16 -55 -20 -5 -4 -48 -15 -94 -24 -47 -9 -92 -21 -100 -25 -9 -5 -50 -16 -91 -26 -41 -9 -79 -20 -85 -24 -5 -4 -28 -13 -50 -20 -51 -16 -216 -102 -264 -137 -34 -26 -83 -65 -126 -101 -57 -49 -53 -39 18 38 142 155 488 459 524 460 6 0 13 4 15 9 5 14 206 126 288 160 41 18 93 40 115 50 22 11 58 24 80 31 258 81 469 258 564 476 48 112 83 317 61 359 -7 13 -10 38 -7 57 3 18 9 52 12 76 7 41 3 71 -31 239 -19 92 -48 153 -74 153 -10 0 -21 -3 -23 -7z m-1803 -2413 c-9 -16 -20 -30 -25 -30 -5 0 -9 -5 -9 -11 0 -6 -15 -32 -33 -58 -19 -25 -37 -53 -41 -61 -3 -8 -31 -53 -61 -100 -30 -47 -64 -103 -76 -125 -12 -22 -25 -42 -28 -45 -4 -3 -12 -16 -19 -30 -6 -14 -28 -52 -47 -85 -20 -33 -46 -82 -59 -110 -33 -69 -48 -86 -64 -76 -16 10 -3 37 85 178 18 29 33 55 33 58 0 2 39 64 87 137 48 73 95 148 105 166 10 18 38 57 61 87 23 29 54 72 69 94 33 48 43 53 22 11z";

/** AssistantIcon's line through the quill while Textus AI is off. */
const STRIKE = "M2.2 1.4L13.8 13.6";

/** Past conversations (the AI panel's header): a clock turned back. */
export function HistoryIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M2.7 8A5.3 5.3 0 1 0 4.25 4.25M2.5 2.4V4.6H4.7M8 5.2V8L10 9.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
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

/** Pop out into a separate window. */
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

/** Copy to clipboard. */
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

/** The same plus as markup, for ProseMirror node views that can't render a
 *  component. */
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

/** The composer's Deep thinking toggle. */
export function LightbulbIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M8 2.2a4 4 0 0 0-2.4 7.2c.5.4.9 1 .9 1.6v.5h3v-.5c0-.6.4-1.2.9-1.6A4 4 0 0 0 8 2.2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M6.6 13.8h2.8"
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

/** Previous/next match in Find & Replace; the caller flips it with a CSS
 *  rotate. */
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

/** The file tree's sort: three lines, shorter each. */
export function SortIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M3 4.5H13M3 8H10M3 11.5H7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

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

/* The window caption, drawn only where the app owns the frame (Windows).
   These break the 16-unit grid on purpose: Windows caption glyphs are fixed
   10x10 hairlines every app draws alike. */

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

// The composer's three modes. No magnifier for Review: that is web search's.

/** Write: a pen nib - new text. */
export function WriteModeIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M8 14.2L3.4 8.4L5.4 2.6H10.6L12.6 8.4L8 14.2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M8 14.2V9.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8.5" r="1.2" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

/** Create: a four-point spark - something new for the app itself. */
export function CreateModeIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M8 1.8C8.4 5.4 10.6 7.6 14.2 8C10.6 8.4 8.4 10.6 8 14.2C7.6 10.6 5.4 8.4 1.8 8C5.4 7.6 7.6 5.4 8 1.8Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Review: a speech bubble with a note in it - Review only comments. */
export function ReviewModeIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M2 3.8C2 3.02 2.63 2.4 3.4 2.4H12.6C13.37 2.4 14 3.02 14 3.8V9.4C14 10.17 13.37 10.8 12.6 10.8H6.4L3.6 13.2V10.8H3.4C2.63 10.8 2 10.17 2 9.4V3.8Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M5 5.4H11M5 7.8H9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
