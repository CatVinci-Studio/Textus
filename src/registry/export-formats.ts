import type { TextKey } from "../i18n/strings";
import formats from "./export-formats.json";

/** A format File › Export writes through pandoc: its writer, its files'
 *  extension, its name, its menu item's words (the native menu's own, and
 *  the drawn menu's key), and whether its files carry pictures inside, so a
 *  diagram goes in as one. One list for the exporter, both menus and the
 *  command line (Rust reads the same file). */
export interface PandocFormat {
  format: string;
  ext: string;
  name: string;
  menu: string;
  key: TextKey;
  embedsImages: boolean;
}

export const PANDOC_FORMATS = formats as readonly PandocFormat[];

export const pandocFormat = (format: string): PandocFormat | undefined =>
  PANDOC_FORMATS.find((f) => f.format === format);
