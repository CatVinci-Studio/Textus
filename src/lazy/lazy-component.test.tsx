// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, expect, it } from "vitest";
import { lazyComponent } from "./lazy-component";
import { lazyModule } from "./lazy-module";

afterEach(cleanup);

const Hello = ({ name }: { name: string }) => <p>Hello {name}</p>;

it("a module already loaded renders in the first frame, not the fallback", async () => {
  const module = lazyModule("test:loaded", async () => ({ Hello }));
  await module.load();
  const Shown = lazyComponent(module, (m) => m.Hello);
  render(
    <Suspense fallback={<p>Loading</p>}>
      <Shown name="there" />
    </Suspense>,
  );
  expect(screen.getByText("Hello there")).toBeInTheDocument();
  expect(screen.queryByText("Loading")).toBeNull();
});

it("a module not yet loaded shows the fallback until it has", async () => {
  const module = lazyModule("test:later", async () => ({ Hello }));
  const Shown = lazyComponent(module, (m) => m.Hello);
  render(
    <Suspense fallback={<p>Loading</p>}>
      <Shown name="later" />
    </Suspense>,
  );
  expect(screen.getByText("Loading")).toBeInTheDocument();
  await act(() => module.load());
  expect(await screen.findByText("Hello later")).toBeInTheDocument();
});
