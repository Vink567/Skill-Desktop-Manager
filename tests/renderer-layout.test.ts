import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("renderer layout", () => {
  it("shows skill details as a page instead of a right-side pane", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");
    const css = readFileSync("src/renderer/styles.css", "utf8");

    expect(app).not.toContain('<aside className="detail-pane"');
    expect(app).toContain('className="app-shell detail-shell"');
    expect(app).toContain('className="detail-page"');
    expect(app.indexOf('className="detail-title"')).toBeLessThan(
      app.indexOf("<button onClick={returnToList}>")
    );
    expect(app.indexOf('className="app-shell detail-shell"')).toBeLessThan(
      app.indexOf('className="topbar"')
    );
    expect(app).toContain("window.scrollTo({ top: 0, left: 0 });");
    expect(app).toContain("listScrollYRef.current = window.scrollY;");
    expect(app).toContain("pendingListScrollRestoreRef.current = true;");
    expect(app).toContain("window.scrollTo({ top: listScrollYRef.current, left: 0 });");
    expect(css).not.toContain("position: fixed");
    expect(css).toContain(".detail-shell");
    expect(css).toContain(".detail-page");
    expect(css).toContain("position: sticky");
    expect(css).toContain("top: 0");
  });

  it("only allows batch deleting selected skills and renders row delete as a button", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");
    const css = readFileSync("src/renderer/styles.css", "utf8");

    expect(app).not.toContain("deleteVisibleOrSelected");
    expect(app).not.toContain("删除当前列表");
    expect(app).toContain("删除已选项");
    expect(app).toContain("onClick={deleteSelectedSkills}");
    expect(app).toContain("disabled={busy || selectedSkillIds.size === 0}");
    expect(app).toContain('className="danger table-action-button"');
    expect(css).toContain(".table-action-button");
    expect(css).toContain("min-width: 74px");
  });

  it("opens details only from the skill information cell", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");
    const css = readFileSync("src/renderer/styles.css", "utf8");

    expect(app).not.toContain('<tr\n                        key={skill.id}\n                        className={skill.id === activeSkillId ? "active-row" : ""}\n                        onClick={() => openSkillDetail(skill.id)}');
    expect(app).toContain('className="skill-detail-cell"');
    expect(app).toContain('<td className="skill-detail-cell" onClick={() => openSkillDetail(skill.id)}>');
    expect(css).toContain(".skill-detail-cell");
    expect(css).toContain("cursor: pointer");
  });

  it("shows a settings view with manual tool directory selection", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");

    expect(app).toContain('type CurrentView = "list" | "detail" | "settings";');
    expect(app).toContain("window.skillManager.settings.onOpen");
    expect(app).toContain("chooseToolSkillsDirectory");
    expect(app).toContain("updateToolSkillsPath");
    expect(app).toContain("手动选择");
    expect(app).toContain("skillsPath: selected");
  });

  it("renders merge-back controls and sync state", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");
    const css = readFileSync("src/renderer/styles.css", "utf8");

    expect(app).toContain("合并回中心仓库");
    expect(app).toContain("getMergePreview");
    expect(app).toContain("applyMerge");
    expect(app).toContain("syncStateLabel(skill.syncState, skill.dirtyFileCount)");
    expect(app).toContain("确认合并");
    expect(app).toContain('state.managed ? "副本" : "目录"');
    expect(app).toContain("可回流");
    expect(css).toContain(".merge-panel");
    expect(css).toContain(".sync-dirty");
    expect(css).toContain(".sync-unmanaged");
  });

  it("renders merge diffs as collapsed color-coded diff cards", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");
    const css = readFileSync("src/renderer/styles.css", "utf8");
    const numberColumnMatches = app.match(/className="diff-line-number"/g) ?? [];

    expect(app).toContain("const diffFiles = preview.files.filter((file) => file.diff)");
    expect(app).toContain("diffFiles.map((file)");
    expect(app).not.toContain("没有文本差异。");
    expect(app).toContain("const [expanded, setExpanded] = useState(false);");
    expect(app).toContain('className="merge-file-main"');
    expect(app).toContain("onClick={() => setExpanded((current) => !current)}");
    expect(app).not.toContain('className="diff-toggle"');
    expect(app).not.toContain("查看差异");
    expect(app).not.toContain("收起差异");
    expect(app).toContain("const diffRows = parseDiffLines(file.diff ?? \"\");");
    expect(app).toContain('className={`diff-row ${diffLineClassName(row)}`}');
    expect(app).toContain("{displayLineNumber(row)}");
    expect(app).toContain('className="diff-line-number"');
    expect(numberColumnMatches).toHaveLength(1);
    expect(app).not.toContain('className="diff-line-marker"');
    expect(app).not.toContain("{row.marker}");
    expect(app).toContain('className="diff-line-code"');
    expect(app).toContain("{formatDiffLineText(row)}");
    expect(app).not.toContain(".filter(isVisibleDiffLine)");
    expect(css).toContain("grid-template-columns: 64px minmax(0, 1fr)");
    expect(css).not.toContain(".diff-line-marker");
    expect(css).toContain(".diff-row-context");
    expect(css).toContain("background: #ffffff");
    expect(css).toContain(".diff-row-added");
    expect(css).toContain(".diff-row-removed");
    expect(css).not.toContain(".diff-line-empty");
    expect(css).toContain(".merge-file-main");
    expect(css).toContain(".merge-file-main[aria-expanded=\"true\"]");
  });

  it("defaults merge resolution to the tool copy and labels options by tool name", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");

    expect(app).toContain("preferredMergeResolution(file)");
    expect(app).toContain('file.resolutionOptions.includes("copy") ? "copy" : file.defaultResolution');
    expect(app).toContain("resolutionLabel(option, toolId)");
    expect(app).toContain('return `采用 ${toolName(toolId)}`;');
    expect(app).not.toContain("采用副本");
    expect(app).not.toContain('return "自动合并";');
  });

  it("labels linked sync as soft-link sync", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");

    expect(app).toContain('return "软链接同步";');
    expect(app).not.toContain('return "链接同步";');
  });
});
