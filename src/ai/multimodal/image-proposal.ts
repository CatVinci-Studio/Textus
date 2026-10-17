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
  return `![${plain(request.alt)}](${path})${request.caption ? `\n\n*${plain(request.caption)}*` : ""}`;
}
