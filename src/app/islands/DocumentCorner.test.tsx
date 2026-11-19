// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en";
import { useDocEndRef } from "../../document-view/doc-end";
import { DocumentCorners } from "./DocumentCorner";

const platform = vi.hoisted(() => ({ phone: false }));
vi.mock("../../engine/controls/usePhoneLayout", () => ({
  usePhoneLayout: () => platform.phone,
}));

function Page() {
  const end = useDocEndRef("t1");
  const tab = { id: "t1", content: "one two three" } as never;
  return (
    <>
      <div className="doc-end" ref={end} />
      <DocumentCorners fronts={[{ tab, frame: "f" }]} lang="en" t={en} />
    </>
  );
}

describe("a document's word count", () => {
  afterEach(() => {
    platform.phone = false;
  });

  it("sits in the page's corner on the desktop", () => {
    const { container } = render(<Page />);
    expect(container.querySelector(".document-corner .word-count")).not.toBe(
      null,
    );
  });

  it("on a phone, under the last block, never over the text", () => {
    platform.phone = true;
    const { container } = render(<Page />);
    expect(container.querySelector(".document-corner .word-count")).toBe(null);
    expect(
      container.querySelector(".doc-end .word-count")?.textContent,
    ).toContain("3");
  });
});
