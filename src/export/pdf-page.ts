import type {
  PdfMargin,
  PdfPaper,
  PdfTextScale,
} from "../prefs/settings-values";

/** The sheet as the PDF renderer lays it out, in CSS px. */
export interface PageGeometry {
  width: number;
  height: number;
  /** The band at the top and bottom of each sheet, matching the sides. */
  margin: number;
}

/**
 * The sheet a PDF export prints on, as Settings chooses it: the paper, the
 * margin left all round, and the text's size. In points for the renderer
 * (export.rs PdfSheet), in CSS px (96 an inch) for the page laid out.
 */
export interface PdfLayout {
  paper: PdfPaper;
  margin: PdfMargin;
  textScale: PdfTextScale;
}

export const DEFAULT_PDF_LAYOUT: PdfLayout = {
  paper: "a4",
  margin: "normal",
  textScale: 1,
};

/** Each paper's size in points. */
const PAPER_PT: Record<PdfPaper, { width: number; height: number }> = {
  a4: { width: 595, height: 842 },
  letter: { width: 612, height: 792 },
  a5: { width: 420, height: 595 },
};

/** Each margin in millimetres: Word's narrow, a print default, an inch. */
const MARGIN_MM: Record<PdfMargin, number> = {
  narrow: 12.7,
  normal: 20,
  wide: 25.4,
};

const PT_PER_PX = 0.75;
const MM_PER_INCH = 25.4;

/** The margin in CSS px. */
export const marginPx = (layout: PdfLayout): number =>
  Math.round((MARGIN_MM[layout.margin] / MM_PER_INCH) * 96);

/** The sheet as the renderer takes it, in points. */
export function pdfSheet(layout: PdfLayout): {
  width: number;
  height: number;
  margin: number;
} {
  const paper = PAPER_PT[layout.paper];
  return { ...paper, margin: (MARGIN_MM[layout.margin] / MM_PER_INCH) * 72 };
}

/**
 * The sheet in CSS px as the engine lays it out. macOS zooms its web view
 * to 3/4 pt a CSS px (pdf_macos.rs), so its sheets are not cut to whole
 * pixels and meet createPDF's exactly; Windows' PrintToPdf cuts pages at
 * whole pixels.
 */
export function pageGeometry(
  layout: PdfLayout,
  engine: "mac" | "windows",
): PageGeometry {
  const { width, height } = PAPER_PT[layout.paper];
  const margin = marginPx(layout);
  return engine === "mac"
    ? { width: width / PT_PER_PX, height: height / PT_PER_PX, margin }
    : {
        width: Math.round(width / PT_PER_PX),
        height: Math.floor(height / PT_PER_PX),
        margin,
      };
}
