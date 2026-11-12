// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FindReplaceBar } from "./FindReplaceBar";
import type { FindReplace } from "./useFindReplace";

afterEach(cleanup);

it("leaves Enter to an input method finishing a word, in Find and in Replace", () => {
  const find = {
    query: "",
    replacement: "",
    caseSensitive: false,
    useRegex: false,
    status: { matchCount: 0, current: 0, error: null },
    replaceOpen: true,
    focusRequest: 0,
    next: vi.fn(),
    prev: vi.fn(),
    replaceOne: vi.fn(),
    setQuery: vi.fn(),
    setReplacement: vi.fn(),
    close: vi.fn(),
  } as unknown as FindReplace;
  const { container } = render(
    <FindReplaceBar findReplace={find} labels={{} as never} />,
  );
  const [findBox, replaceBox] = container.querySelectorAll("input");
  fireEvent.keyDown(findBox, { key: "Enter", keyCode: 229 });
  fireEvent.keyDown(replaceBox, { key: "Enter", keyCode: 229 });
  expect(find.next).not.toHaveBeenCalled();
  expect(find.replaceOne).not.toHaveBeenCalled();
  fireEvent.keyDown(findBox, { key: "Enter" });
  expect(find.next).toHaveBeenCalledOnce();
});
