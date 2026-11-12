import { Tooltip } from "./Tooltip";

/**
 * A path on one line, however long: short of room its middle gives way
 * first, then its last name, and the whole shows on hover (.tx-path) -
 * unless what holds it shows it already (`tip` false).
 */
export function PathText({
  path,
  tip = true,
}: {
  path: string;
  tip?: boolean;
}) {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
  const head = path.slice(0, cut);
  const tail = path.slice(cut) || path;
  const line = (
    <span
      className="tx-path"
      tabIndex={-1}
      // Its last name kept whole up to a few words: past that, what is
      // beside it wraps rather than cutting the name.
      style={{ minWidth: `min(${Math.min(tail.length, 24)}ch, 100%)` }}
    >
      {cut > 0 && tail !== path && <span className="tx-path-head">{head}</span>}
      <span className="tx-path-tail">{tail}</span>
    </span>
  );
  return tip ? <Tooltip text={path}>{line}</Tooltip> : line;
}
