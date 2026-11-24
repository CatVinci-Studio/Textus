/**
 * Handlers kept by `<plugin id>#<its id>`: added and removed one at a time,
 * and all of a plugin's at once when it stops.
 */
export function pluginHandlers<T>() {
  const handlers = new Map<string, T & { plugin: string }>();
  return {
    add(plugin: string, id: string, handler: T): void {
      handlers.set(`${plugin}#${id}`, { plugin, ...handler });
    },
    remove(plugin: string, id: string): void {
      handlers.delete(`${plugin}#${id}`);
    },
    forget(plugin: string): void {
      for (const [key, handler] of handlers)
        if (handler.plugin === plugin) handlers.delete(key);
    },
    all: () => [...handlers.values()],
  };
}
