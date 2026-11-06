/** A cell's `|`s escaped so none ends the cell: GFM pairs backslashes, so a
 *  bar after an even run (`\\|`) gets one more; `\|` is already escaped. */
export const escapeCellPipes = (text: string): string =>
  text.replace(/(\\*)\|/g, (run, slashes: string) =>
    slashes.length % 2 ? run : `${slashes}\\|`,
  );

/** What a cell's code or formula holds once the row's `\|`s are read. */
export const unescapeCellPipes = (text: string): string =>
  text.replace(/\\\|/g, "|");
