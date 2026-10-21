// A line diff of two texts: the longest common run of lines kept, the rest
// removed or added - enough to see what changed between two versions.
// Past ~4 million line pairs it gives up and says so (null).
(function (root) {
  "use strict";
  function lineDiff(before, after) {
    const a = before.split("\n");
    const b = after.split("\n");
    // Common head and tail first: most saves change a little in the middle.
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start])
      start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA--;
      endB--;
    }
    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);
    if (midA.length * midB.length > 4e6) return null;
    const n = midA.length;
    const m = midB.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i][j] =
          midA[i] === midB[j]
            ? lcs[i + 1][j + 1] + 1
            : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    const out = a.slice(0, start).map((line) => ({ kind: "same", line: line }));
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        out.push({ kind: "same", line: midA[i++] });
        j++;
      } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
        out.push({ kind: "added", line: midB[j++] });
      } else {
        out.push({ kind: "removed", line: midA[i++] });
      }
    }
    return out.concat(
      a.slice(endA).map((line) => ({ kind: "same", line: line })),
    );
  }
  root.lineDiff = lineDiff;
})(typeof window !== "undefined" ? window : globalThis);
