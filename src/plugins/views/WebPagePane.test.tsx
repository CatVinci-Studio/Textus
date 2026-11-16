// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import en from "../../i18n/locales/en";

vi.mock("../../platform/capabilities", async (real) => ({
  ...(await real<typeof import("../../platform/capabilities")>()),
  hasNativeWebPages: false,
}));

const { WebPagePane } = await import("./WebPagePane");
const { startWindowTabs, windowTabs } =
  await import("../../engine/layout/store");

it("an address typed in a framed web page is its tab's", () => {
  const tab = {
    id: "w",
    view: {
      plugin: "p",
      view: "web",
      kind: "web",
      resource: "https://example.com/",
    },
  };
  startWindowTabs([tab], () => ({ id: "blank" }));
  const { getByLabelText } = render(
    <WebPagePane tabId="w" url="https://example.com/" shown t={en} />,
  );
  const address = getByLabelText(en.webPageAddress);
  fireEvent.change(address, { target: { value: "example.org/next" } });
  fireEvent.submit(address.closest("form")!);
  const now = windowTabs<typeof tab>().find((t) => t.id === "w");
  expect(now?.view.resource).toBe("https://example.org/next");
});
