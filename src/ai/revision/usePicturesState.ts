import { useEffect, useSyncExternalStore } from "react";
import {
  generatedIdsIn,
  loadGeneratedImage,
  onPictureSettled,
  picturesState,
  type PictureState,
} from "./generated-images";

const subscribe = (listener: () => void) => {
  const stop = onPictureSettled(listener);
  return () => {
    stop();
  };
};

/** Where the pictures being made in `markdown` are, which an Accept waits on.
 *  Asks for each, so the answer comes whether or not its frame is on screen. */
export function usePicturesState(markdown: string): PictureState {
  useEffect(() => {
    for (const id of generatedIdsIn(markdown)) void loadGeneratedImage(id);
  }, [markdown]);
  return useSyncExternalStore(subscribe, () => picturesState(markdown));
}
