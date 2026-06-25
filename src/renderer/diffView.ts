export type DiffRowType = "added" | "removed" | "context" | "hunk" | "meta";

export interface DiffViewRow {
  key: string;
  type: DiffRowType;
  marker: "+" | "-" | " ";
  text: string;
  isEmpty: boolean;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export function parseDiffLines(diff: string): DiffViewRow[] {
  if (!diff) {
    return [];
  }

  let oldLineNumber = 1;
  let newLineNumber = 1;
  const rows: DiffViewRow[] = [];

  diff.split(/\r?\n/).forEach((line, index) => {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const text = stripDiffPrefix(line);
      const currentNewLineNumber = newLineNumber++;
      if (text.length > 0) {
        rows.push(
          makeRow({
            index,
            type: "added",
            marker: "+",
            text,
            newLineNumber: currentNewLineNumber
          })
        );
      }
      return;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      const text = stripDiffPrefix(line);
      const currentOldLineNumber = oldLineNumber++;
      if (text.length > 0) {
        rows.push(
          makeRow({
            index,
            type: "removed",
            marker: "-",
            text,
            oldLineNumber: currentOldLineNumber
          })
        );
      }
      return;
    }

    if (line.startsWith("@@")) {
      rows.push(
        makeRow({
          index,
          type: "hunk",
          marker: " ",
          text: line
        })
      );
      return;
    }

    const text = line.startsWith("  ") ? line.slice(2) : line;
    rows.push(
      makeRow({
        index,
        type: line.startsWith("  ") ? "context" : "meta",
        marker: " ",
        text,
        oldLineNumber: oldLineNumber++,
        newLineNumber: newLineNumber++
      })
    );
  });

  return rows;
}

export function diffLineClassName(row: DiffViewRow): string {
  switch (row.type) {
    case "added":
      return "diff-row-added";
    case "removed":
      return "diff-row-removed";
    case "hunk":
      return "diff-row-hunk";
    case "meta":
      return "diff-row-meta";
    default:
      return "diff-row-context";
  }
}

export function formatDiffLineText(row: DiffViewRow): string {
  return row.text;
}

export function displayLineNumber(row: DiffViewRow): string {
  const lineNumber = row.type === "added" ? row.newLineNumber : row.oldLineNumber;
  return lineNumber === undefined ? "" : String(lineNumber);
}

function makeRow({
  index,
  type,
  marker,
  text,
  oldLineNumber,
  newLineNumber
}: Omit<DiffViewRow, "key" | "isEmpty"> & { index: number }): DiffViewRow {
  return {
    key: `${index}-${type}-${oldLineNumber ?? ""}-${newLineNumber ?? ""}-${text}`,
    type,
    marker,
    text,
    isEmpty: text.length === 0,
    oldLineNumber,
    newLineNumber
  };
}

function stripDiffPrefix(line: string): string {
  return line.length > 1 && line[1] === " " ? line.slice(2) : line.slice(1);
}
