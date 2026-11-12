// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { EditorKept } from "./kept";
import { registerTabEditor } from "../../editor/tab-editor";

afterEach(cleanup);

it("lets a hidden editor go as soon as nothing holds it", () => {
  const release = registerTabEditor("t1", "held", true);
  const view = render(
    <EditorKept tabId="t1" shown={false}>
      <p>editor</p>
    </EditorKept>,
  );
  expect(view.queryByText("editor")).not.toBeNull();
  act(() => release());
  expect(view.queryByText("editor")).toBeNull();
});
