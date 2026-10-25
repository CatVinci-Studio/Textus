/**
 * The dev browser's stand-in for native web pages (commands/web_page.rs):
 * a frame laid over the page's place as the native webview would be - so
 * an e2e test sees where the app put it, and what it shows - with the
 * address it arrives at sent back as `web-page-navigated`.
 */

type Bounds = { x: number; y: number; width: number; height: number };

const frames = new Map<string, HTMLIFrameElement>();

function frameFor(
  id: string,
  url: string,
  emit: (event: string, payload: unknown) => void,
): HTMLIFrameElement {
  let frame = frames.get(id);
  if (frame) return frame;
  frame = document.createElement("iframe");
  frame.className = "dev-native-web-page";
  frame.dataset.pageId = id;
  frame.style.cssText = "position:fixed;border:0;z-index:2147483000;";
  frame.addEventListener("load", () =>
    emit("web-page-navigated", { id, url: frame!.src }),
  );
  frame.src = url;
  document.body.append(frame);
  frames.set(id, frame);
  return frame;
}

/** A web_page_* command's answer, or null for any other command. */
export function webPageCommand(
  cmd: string,
  args: Record<string, unknown>,
  emit: (event: string, payload: unknown) => void,
): Promise<unknown> | null {
  if (!cmd.startsWith("web_page_")) return null;
  const id = String(args.id);
  const frame = frames.get(id);
  switch (cmd) {
    case "web_page_show": {
      const shown = frameFor(id, String(args.url), emit);
      const b = args.bounds as Bounds;
      Object.assign(shown.style, {
        display: "block",
        left: `${b.x}px`,
        top: `${b.y}px`,
        width: `${b.width}px`,
        height: `${b.height}px`,
      });
      break;
    }
    case "web_page_hide":
      if (frame) frame.style.display = "none";
      break;
    case "web_page_close":
      frame?.remove();
      frames.delete(id);
      break;
    case "web_page_navigate":
      if (frame) frame.src = String(args.url);
      break;
    case "web_page_reload":
      frame?.contentWindow?.location.reload();
      break;
  }
  return Promise.resolve(null);
}
