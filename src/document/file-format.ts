// A file's line endings and BOM, kept through an edit: the editor works in
// "\n", and a file is written back the way it is on disk.

export interface FileFormat {
  crlf: boolean;
  bom: boolean;
}

const BOM = "﻿";

/** How `raw` (a file's text as read) ends its lines and whether it opens
 *  with a BOM. Mixed endings count by majority; a file with no line break
 *  at all is "\n". */
export function detectFormat(raw: string): FileFormat {
  const crlf = raw.match(/\r\n/g)?.length ?? 0;
  const lf = (raw.match(/\n/g)?.length ?? 0) - crlf;
  return { crlf: crlf > lf, bom: raw.startsWith(BOM) };
}

/** A file's text as the editor wants it: no BOM, "\n" line breaks. */
export function toEditorText(raw: string): string {
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}

/** The editor's text as the file should hold it. */
export function toFileText(text: string, format: FileFormat): string {
  const lines = format.crlf ? text.replace(/\r?\n/g, "\r\n") : text;
  return format.bom ? BOM + lines : lines;
}
