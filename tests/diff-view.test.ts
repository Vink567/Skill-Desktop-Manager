import { describe, expect, it } from "vitest";

import {
  diffLineClassName,
  displayLineNumber,
  formatDiffLineText,
  parseDiffLines
} from "../src/renderer/diffView";

describe("diff view rows", () => {
  it("keeps unchanged rows white, uses one display line number, and hides changed blank rows", () => {
    const rows = parseDiffLines(["  same", "- old", "+ new", "- ", "  ", "+ ", "  after"].join("\n"));

    expect(rows).toMatchObject([
      {
        type: "context",
        marker: " ",
        oldLineNumber: 1,
        newLineNumber: 1,
        text: "same",
        isEmpty: false
      },
      {
        type: "removed",
        marker: "-",
        oldLineNumber: 2,
        newLineNumber: undefined,
        text: "old",
        isEmpty: false
      },
      {
        type: "added",
        marker: "+",
        oldLineNumber: undefined,
        newLineNumber: 2,
        text: "new",
        isEmpty: false
      },
      {
        type: "context",
        marker: " ",
        oldLineNumber: 4,
        newLineNumber: 3,
        text: "",
        isEmpty: true
      },
      {
        type: "context",
        marker: " ",
        oldLineNumber: 5,
        newLineNumber: 5,
        text: "after",
        isEmpty: false
      }
    ]);

    expect(diffLineClassName(rows[0])).toBe("diff-row-context");
    expect(diffLineClassName(rows[1])).toBe("diff-row-removed");
    expect(diffLineClassName(rows[2])).toBe("diff-row-added");
    expect(displayLineNumber(rows[0])).toBe("1");
    expect(displayLineNumber(rows[1])).toBe("2");
    expect(displayLineNumber(rows[2])).toBe("2");
    expect(displayLineNumber(rows[3])).toBe("4");
    expect(displayLineNumber(rows[4])).toBe("5");
    expect(formatDiffLineText(rows[3])).toBe("");
    expect(rows).toHaveLength(5);
  });
});
