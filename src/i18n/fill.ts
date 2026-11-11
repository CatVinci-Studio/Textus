/**
 * `template` with each `{name}` it has filled from `values`: every place a
 * name stands, and the value as written (a `$` in it is no pattern, as
 * String.replace would read it). A name `values` lacks stays as it is.
 */
export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : whole,
  );
}
