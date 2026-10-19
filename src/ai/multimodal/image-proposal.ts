import type { ImageGenerationRequest } from "../../platform/ipc";

/** Treat alt/caption as plain text; only the generated asset path is a URL. */
function plain(text: string) {
  return text.replace(/[\\`*_[\]<>#!|]/g, "\\$&").replace(/[\r\n]+/g, " ");
}
export function imageMarkdown(
  src: string,
  request: ImageGenerationRequest,
): string {
  const path = encodeURI(src.replace(/\\/g, "/"))
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
  // Every picture carries a caption (centred under it - image-plugin.ts):
  // the model's, else its description - unless that only repeats the
  // passage it illustrates (a right-click picture's alt is the selection).
  const described = plain(request.alt || "");
  const fallback =
    described && !(request.anchor ?? "").includes(described) ? described : "";
  const caption = plain(request.caption || fallback).slice(0, 80);
  return `![${plain(request.alt)}](${path})${caption ? `\n\n*${caption}*` : ""}`;
}
