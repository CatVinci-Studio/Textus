import { Tooltip } from "./Tooltip";

/**
 * A path on one line, however long: short of room its middle gives way
 * first, then its last name, and the whole shows on hover (.tx-path).
 */
export function PathText({ path }: { path: string }) {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
  const head = path.slice(0, cut);
  const tail = path.slice(cut) || path;
  return (
    <Tooltip text={path}>
      <span className="tx-path" tabIndex={-1}>
        {cut > 0 && tail !== path && (
          <span className="tx-path-head">{head}</span>
        )}
        <span className="tx-path-tail">{tail}</span>
      </span>
    </Tooltip>
  );
}
