import { describe, expect, it } from "vitest";
import { searchFold } from "./search-fold";

describe("searchFold", () => {
  it("drops the accents on Latin letters, in either Unicode form", () => {
    expect(searchFold("Café")).toBe("cafe");
    expect(searchFold("Café".normalize("NFD"))).toBe("cafe");
    expect(searchFold("Über España")).toBe("uber espana");
  });

  it("keeps the marks of other scripts", () => {
    expect(searchFold("が")).toBe("が");
    expect(searchFold("한국")).toBe("한국");
    expect(searchFold("背诵")).toBe("背诵");
  });
});
