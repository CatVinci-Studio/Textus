import { describe, expect, it } from "vitest";
import { imageFolderExample } from "./image-folder";

const example = (folder: string) =>
  imageFolderExample(folder, "notes", "photo.png");

describe("imageFolderExample", () => {
  it("shows each preset's link as fs.rs writes it", () => {
    expect(example("assets")).toBe("assets/photo.png");
    expect(example("./")).toBe("photo.png");
    expect(example("${filename}.assets")).toBe("notes.assets/photo.png");
  });

  it("writes a custom folder with forward slashes, tidied", () => {
    expect(example("img\\shots\\")).toBe("img/shots/photo.png");
    expect(example(" ./img/./x/../shots ")).toBe("img/shots/photo.png");
    expect(example("../images")).toBe("../images/photo.png");
  });

  it("has no example for a folder the backend refuses", () => {
    for (const folder of ["", " ", "/tmp/img", "\\img", "C:\\img", "a//b"])
      expect(example(folder)).toBeNull();
  });
});
