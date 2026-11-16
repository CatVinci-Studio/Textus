import { describe, expect, it } from "vitest";
import { createRequestQueue, createSubscribers } from "./store";

describe("a module's store", () => {
  it("tells each listener of a change until it stops listening", () => {
    const store = createSubscribers();
    let told = 0;
    const stop = store.subscribe(() => told++);
    store.publish();
    stop();
    store.publish();
    expect(told).toBe(1);
  });

  it("starts what feeds it with the first listener and stops it after the last", () => {
    let running = 0;
    const store = createSubscribers(() => {
      running++;
      return () => running--;
    });
    const a = store.subscribe(() => {});
    const b = store.subscribe(() => {});
    expect(running).toBe(1);
    a();
    expect(running).toBe(1);
    b();
    b();
    expect(running).toBe(0);
    store.subscribe(() => {})();
    expect(running).toBe(0);
  });

  it("shows requests one at a time, oldest first, the list kept until it changes", () => {
    const queue = createRequestQueue<{ id: number; name: string }>();
    let told = 0;
    queue.subscribe(() => told++);
    queue.add((id) => ({ id, name: "first" }));
    queue.add((id) => ({ id, name: "second" }));
    const list = queue.all();
    expect(queue.all()).toBe(list);
    expect(queue.now()?.name).toBe("first");
    queue.remove(queue.now()!.id);
    expect(queue.now()?.name).toBe("second");
    expect(told).toBe(3);
  });
});
