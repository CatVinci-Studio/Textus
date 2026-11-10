import { useEffect } from "react";
import {
  attachDocument,
  detachDocument,
  type DocumentPanel,
  type DocumentPort,
} from "./document-port";

/** While `active`, this document is the one the window's conversations
 *  work on: `port` the same object while it is, `panel` as each render
 *  has it. */
export function useAttachDocument(
  active: boolean,
  port: DocumentPort,
  panel?: DocumentPanel,
): void {
  useEffect(() => {
    if (active) attachDocument(port, panel);
    else detachDocument(port);
  });
  useEffect(() => () => detachDocument(port), [port]);
}
