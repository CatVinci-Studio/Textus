// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../platform/ipc", () => ({
  fs: {
    // Every name is a note of the folder, but "Missing".
    resolveNoteLink: async (_doc: string, link: string) => ({
      path: `/v/${link}.md`,
      exists: link !== "Missing",
    }),
  },
}));

const { addEmbedProvider } = await import("./embed-sources");
const { embedKey, fillEmbed, noteEmbedOf, releaseEmbed } =
  await import("./note-embed-render");

const notes: Record<string, string> = {
  "/v/A.md": "Alpha ![[B]]",
  "/v/B.md": "Beta ![[A]]",
  "/v/Self.md": "Me ![[Self]]",
};

let remove = () => {};
const drawn: HTMLElement[] = [];
// Each embed's editor let go, with the embeds it drew, before the next.
afterEach(() => {
  remove();
  for (const el of drawn.splice(0)) releaseEmbed(el);
  document.body.replaceChildren();
});

type Target = { path: string; heading?: string };
const byPath = (t: Target) =>
  notes[t.path] === undefined ? null : { markdown: notes[t.path] };

async function draw(
  source: string,
  docPath: string,
  answer: (t: Target) => { markdown: string } | null = byPath,
) {
  const provide = vi.fn(async (target: Target) => answer(target));
  remove = addEmbedProvider({
    owner: "p",
    id: "p.embed",
    kinds: ["note", "heading", "block"],
    provide,
  });
  const el = document.createElement("span");
  document.body.append(el);
  drawn.push(el);
  await fillEmbed(el, noteEmbedOf(source)!, {
    docPath,
    folder: "/v",
    depth: 1,
    chain: [embedKey(docPath)],
    signal: new AbortController().signal,
    read: () => {},
  });
  return { el, provide };
}

describe("a note embed", () => {
  it("draws the note's Markdown read-only, named for when it is folded", async () => {
    const { el } = await draw("![[A]]", "/v/Doc.md");
    expect(el.querySelector(".block-folded-name")?.textContent).toBe("A");
    expect(el.hasAttribute("data-folded")).toBe(false);
    expect(el.querySelector(".note-embed-body p")?.textContent).toContain(
      "Alpha",
    );
  });

  it("stops a loop: a note already on the way down shows as its name", async () => {
    const { el, provide } = await draw("![[A]]", "/v/Doc.md");
    // A shows B (drawn by A's editor a moment later), whose ![[A]] is a chip.
    await vi.waitFor(() =>
      expect(el.querySelectorAll(".note-embed-chip")).toHaveLength(1),
    );
    expect(el.querySelector(".note-embed-chip")?.textContent).toBe("A");
    expect(provide).toHaveBeenCalledTimes(2);
  });

  it("never draws the document inside itself", async () => {
    const { el, provide } = await draw("![[Self]]", "/v/Self.md");
    expect(el.className).toBe("note-embed-chip");
    expect(provide).not.toHaveBeenCalled();
  });

  it("goes at most 5 deep", async () => {
    // Each section of Deep embeds the next one.
    const { el, provide } = await draw("![[Deep#H1]]", "/v/Doc.md", (t) =>
      t.heading
        ? { markdown: `Level ![[Deep#H${Number(t.heading.slice(1)) + 1}]]` }
        : null,
    );
    await vi.waitFor(
      () =>
        expect(el.querySelector(".note-embed-chip")?.textContent).toBe(
          "Deep › H6",
        ),
      { timeout: 4000 },
    );
    expect(provide).toHaveBeenCalledTimes(5);
  });

  it("shows a missing note's name, dimmed", async () => {
    const { el } = await draw("![[Missing]]", "/v/Doc.md");
    expect(el.className).toBe("note-embed-chip wikilink-missing");
  });

  it("leaves pictures and other files to the core", () => {
    expect(noteEmbedOf("![[pic.png]]")).toBeNull();
    expect(noteEmbedOf("![[paper.pdf]]")).toBeNull();
    expect(noteEmbedOf("![[Note v1.2]]")?.note).toBe("Note v1.2");
  });
});
