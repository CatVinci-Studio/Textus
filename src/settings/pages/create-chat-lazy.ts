import { lazy } from "react";

// Create's chat is the editor's; Settings loads it only once Create opens.
// Its own module: what holds this import is placed with the startup code,
// so it holds nothing else.
export const CreateChat = lazy(() =>
  import("./CreateChat").then((m) => ({ default: m.CreateChat })),
);
