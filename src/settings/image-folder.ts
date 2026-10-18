/** The Image folder presets offered in Settings > Images (`imageFolder`). */
export const IMAGE_FOLDER_PRESETS = ["assets", "./", "${filename}.assets"];

/**
 * The src a pasted `name` would get in a document called `docName` with
 * this image folder setting, for the example beside each choice; null for
 * a setting the backend refuses. Mirrors ImageFolder::resolve in
 * src-tauri/src/commands/fs.rs, which is what decides where images go -
 * a change to one is a change to both.
 */
export function imageFolderExample(
  folder: string,
  docName: string,
  name: string,
): string | null {
  const setting = folder.trim();
  if (!setting || /^[\\/]|^[a-z]:/i.test(setting)) return null;
  const segments = setting.split(/[\\/]/);
  const parts: string[] = [];
  for (const [i, segment] of segments.entries()) {
    if (segment === "" && i > 0 && i === segments.length - 1) continue;
    if (segment === "") return null;
    if (segment === ".") continue;
    if (
      segment === ".." &&
      parts.length > 0 &&
      parts[parts.length - 1] !== ".."
    )
      parts.pop();
    else parts.push(segment.split("${filename}").join(docName));
  }
  return [...parts, name].join("/");
}
