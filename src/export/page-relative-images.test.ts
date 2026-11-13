// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

vi.mock("../editor/images/rooted-image", () => ({
  rootedImagePath: async (src: string) => `/site${src}`,
}));

import { pageRelativeImages } from "./standalone-html";

it("names a picture from the folder's root from the page instead, for a page opened from disk", async () => {
  const html = await pageRelativeImages(
    '<p><img src="/assets/a b.png"><img src="pics/c.png"><img src="//cdn.x/d.png"></p>',
    "/site/posts/hello.md",
    "/site/posts/hello.html",
  );
  expect(html).toContain('src="../assets/a%20b.png"');
  expect(html).toContain('src="pics/c.png"');
  expect(html).toContain('src="//cdn.x/d.png"');
});
