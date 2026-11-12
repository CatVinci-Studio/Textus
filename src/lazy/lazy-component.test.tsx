// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Component, Suspense, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
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

it("a module not yet loaded draws nothing until it has, then itself - no suspense held back", async () => {
  const module = lazyModule("test:later", async () => ({ Hello }));
  const Shown = lazyComponent(module, (m) => m.Hello);
  render(
    <Suspense fallback={<p>Loading</p>}>
      <Shown name="later" />
    </Suspense>,
  );
  expect(screen.queryByText("Loading")).toBeNull();
  expect(await screen.findByText("Hello later")).toBeInTheDocument();
});

it("a module that fails to load throws to the error boundary", async () => {
  const module = lazyModule(
    "test:broken",
    async (): Promise<{
      Hello: typeof Hello;
    }> => {
      throw new Error("gone");
    },
  );
  const Shown = lazyComponent(module, (m) => m.Hello);
  class Boundary extends Component<
    { children: ReactNode },
    { failed: boolean }
  > {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    render() {
      return this.state.failed ? <p>Failed</p> : this.props.children;
    }
  }
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <Boundary>
      <Shown name="never" />
    </Boundary>,
  );
  expect(await screen.findByText("Failed")).toBeInTheDocument();
  quiet.mockRestore();
});
