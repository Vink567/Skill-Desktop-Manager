import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("main window menu", () => {
  it("uses Chinese labels for the application menu", () => {
    const main = readFileSync("electron/main/index.ts", "utf8");

    expect(main).toContain('import { app, BrowserWindow, Menu, shell } from "electron";');
    expect(main).toContain("Menu.setApplicationMenu");
    expect(main).toContain('label: "文件"');
    expect(main).not.toContain('label: "编辑"');
    expect(main).toContain('label: "视图"');
    expect(main).toContain('label: "窗口"');
    expect(main).toContain('label: "设置"');
    expect(main).toContain('label: "手动选择目录..."');
    expect(main).toContain('webContents.send("settings:open")');
    expect(main).toContain('label: "帮助"');
  });
});
