import type { Permission } from "./store/manifest";

/** Whether `granted` covers `permission`: writing files includes reading
 *  them, as every write goes through the folder's root. Its own module:
 *  the window checks it at startup without the API's table. */
export function grants(
  granted: readonly string[],
  permission: Permission,
): boolean {
  return (
    granted.includes(permission) ||
    (permission === "files.read" && granted.includes("files.write"))
  );
}
