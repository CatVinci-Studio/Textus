import { describe, expect, it } from "vitest";
import {
  imageFolderExample,
  isImageSubfolder,
  storedImageFolder,
} from "./image-folder";

const example = (folder: string) => imageFolderExample(folder, "photo.png");

describe("imageFolderExample", () => {
  it("shows each choice's link as fs.rs writes it", () => {
    expect(example("assets")).toBe("assets/photo.png");
    expect(example("./")).toBe("photo.png");
  });

  it("writes a subfolder with forward slashes, tidied", () => {
    expect(example(" img\\shots\\ ")).toBe("img/shots/photo.png");
    expect(example("./img/./shots")).toBe("img/shots/photo.png");
  });

  it("has no example for a folder the backend refuses", () => {
    for (const folder of [
      "",
      " ",
      "/tmp/img",
      "\\img",
      "C:\\img",
      "a//b",
      "../images",
      "img/../x",
    ])
      expect(example(folder)).toBeNull();
  });
});

describe("isImageSubfolder", () => {
  it("takes a name inside the document's folder", () => {
    expect(isImageSubfolder("img")).toBe(true);
    expect(isImageSubfolder("img/shots")).toBe(true);
  });

  it("refuses the document's folder itself, a climb out and a root", () => {
    for (const name of ["", ".", "./", "..", "../img", "/img", "C:img"])
      expect(isImageSubfolder(name)).toBe(false);
  });
});

describe("storedImageFolder", () => {
  it("keeps the two choices as they are", () => {
    expect(storedImageFolder("assets")).toBe("assets");
    expect(storedImageFolder("./")).toBe("./");
    expect(storedImageFolder(".")).toBe("./");
  });

  it("turns the <document>.assets pattern into assets", () => {
    expect(storedImageFolder("${filename}.assets")).toBe("assets");
    expect(storedImageFolder("img-${filename}")).toBe("assets");
  });

  it("keeps a folder of the user's own when it is one plain name", () => {
    expect(storedImageFolder("img")).toBe("img");
    expect(storedImageFolder(" pictures/ ")).toBe("pictures");
  });

  it("turns a path, a climb out or a refused folder into assets", () => {
    for (const stored of ["img/shots", "../images", "/tmp/img", "", 3, null])
      expect(storedImageFolder(stored)).toBe("assets");
  });
});
