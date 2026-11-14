import type { ImageAttachment } from "../types";
import type { ContentBlock } from "./acp-client";

/** A message as an agent's prompt: its text, a link to the document it is
 *  about, and the pictures attached (for an agent that reads them). */
export function promptBlocks(o: {
  message: string;
  docPath: string | null;
  images: ImageAttachment[];
}): ContentBlock[] {
  const prompt: ContentBlock[] = [{ type: "text", text: o.message }];
  if (o.docPath)
    prompt.push({
      type: "resource_link",
      uri: fileUri(o.docPath),
      name: o.docPath.split(/[\\/]/).pop() ?? o.docPath,
      mimeType: "text/markdown",
    });
  for (const image of o.images)
    prompt.push({
      type: "image",
      mimeType: image.mime,
      data: image.dataBase64,
    });
  return prompt;
}

/** `path` as a file: URI, its spaces and the rest encoded; a Windows
 *  drive's path as file:///C:/… */
export function fileUri(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  const encoded = (slashed.startsWith("/") ? slashed : "/" + slashed)
    .split("/")
    .map(encodeURIComponent)
    .join("/")
    .replace(/^\/([A-Za-z])%3A/, "/$1:");
  return "file://" + encoded;
}
