import type { Settings } from "../prefs/settings-types";
import type { PandocOptions_Deserialize } from "../platform/bindings/app";

/** The settings a Pandoc export reads (Settings › Editor › Export, and its
 *  Advanced arguments). */
export type PandocSettings = Pick<
  Settings,
  | "docxReferenceDoc"
  | "exportToc"
  | "exportNumberHeadings"
  | "exportBibliography"
  | "exportCsl"
  | "pandocArgs"
>;

/** What the export command takes for `format`; Rust's `PandocOptions` in
 *  `commands/export/pandoc_options.rs`. Arguments for every format first. */
export function pandocOptions(
  settings: PandocSettings,
  format: string,
): PandocOptions_Deserialize {
  const args = settings.pandocArgs as Partial<Record<string, string[]>>;
  return {
    toc: settings.exportToc,
    numberSections: settings.exportNumberHeadings,
    bibliography: settings.exportBibliography || null,
    csl: settings.exportCsl || null,
    extraArgs: [...(args.all ?? []), ...(args[format] ?? [])],
  };
}
