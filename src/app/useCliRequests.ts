import { useEffect, useRef } from "react";
import { cli } from "../platform/ipc";
import { isDesktopApp } from "../platform/capabilities";
import { listenToThisWindow } from "../platform/events";
import {
  answerCliRequest,
  type CliRequest,
  type CliWindow,
} from "./cli-requests";

/** Takes `textus` requests in this window while it is open. */
export function useCliRequests(window: CliWindow): void {
  const latest = useRef(window);
  latest.current = window;

  useEffect(() => {
    if (!isDesktopApp) return;
    const stop = listenToThisWindow<CliRequest>("cli-request", (event) => {
      const request = event.payload;
      void answerCliRequest(request, () => latest.current).then((a) =>
        cli.respond(request.id, a.out, a.err, a.exit).catch(() => {}),
      );
    });
    void stop.then(() => cli.listening(true)).catch(() => {});
    return () => {
      void stop.then((off) => off());
      void cli.listening(false).catch(() => {});
    };
  }, []);
}
