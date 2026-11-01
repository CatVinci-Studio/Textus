/** The folder open in this window, or the sidebar's root, as the window
 *  reports it: a wikilink or an embed is looked for there when no
 *  `.obsidian` folder says where. */
let read: () => string | null = () => null;

export function windowFolder(): string | null {
  return read();
}

/** The window says where to read it from; null when it closes. */
export function setWindowFolderSource(source: (() => string | null) | null) {
  read = source ?? (() => null);
}
