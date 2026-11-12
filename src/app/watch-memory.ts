import { systemIpc } from "../platform/ipc";
import { listenToThisWindow } from "../platform/events";
import { onMemoryLevel, setMemoryState } from "../utils/memory-policy";
import { releaseIdleMemory, watchMemoryIdle } from "../utils/memory-idle";

/**
 * Follows the machine's memory: its size at start, then the system's
 * pressure as it moves (memory_level.rs). Very short of memory, the caches
 * kept to be quick go at once, as when the window is left alone.
 */
export function watchMemory(): void {
  watchMemoryIdle();
  onMemoryLevel((level) => {
    if (level === "critical") releaseIdleMemory();
  });
  void systemIpc
    .memoryState()
    .then((state) => state && setMemoryState(state))
    .catch(() => {});
  void listenToThisWindow<{ totalMb: number; pressure: number }>(
    "memory-level",
    (event) => setMemoryState(event.payload),
  );
}
