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
});
