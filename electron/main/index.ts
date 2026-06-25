import { app, BrowserWindow, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { registerIpcHandlers } from "./ipc";

const isDev = !app.isPackaged;
const isSmoke = process.env.SKILL_MANAGER_SMOKE === "1";
const isScreenshot = Boolean(process.env.SKILL_MANAGER_SCREENSHOT_PATH);

if (isScreenshot && process.env.SKILL_MANAGER_SCREENSHOT_USER_DATA_DIR) {
  app.setPath("userData", process.env.SKILL_MANAGER_SCREENSHOT_USER_DATA_DIR);
}

if (isSmoke || isScreenshot) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("no-sandbox");
}

function openSettings(): void {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  targetWindow?.webContents.send("settings:open");
}

function configureApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { role: "quit", label: "退出" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "切换全屏" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "close", label: "关闭" }
      ]
    },
    {
      label: "设置",
      submenu: [
        { label: "手动选择目录...", click: openSettings }
      ]
    },
    {
      label: "帮助",
      submenu: [
        { role: "about", label: "关于 Skill 桌面管理器" }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: isScreenshot ? 1280 : 1180,
    height: isScreenshot ? 850 : 760,
    minWidth: 940,
    minHeight: 620,
    show: !(isSmoke || isScreenshot),
    title: `Skill Desktop Manager v${app.getVersion()}`,
    backgroundColor: "#f6f3ee",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const loadPromise =
    isDev && process.env.ELECTRON_RENDERER_URL
      ? mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
      : mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  if (isSmoke) {
    loadPromise
      .then(() => runSmoke(mainWindow))
      .catch((error) => {
        console.error("[smoke] window load failed", error);
        app.exit(1);
      });
  } else if (isScreenshot) {
    loadPromise
      .then(() => captureScreenshot(mainWindow))
      .catch((error) => {
        console.error("[screenshot] window load failed", error);
        app.exit(1);
      });
  }

  return mainWindow;
}

async function captureScreenshot(mainWindow: BrowserWindow): Promise<void> {
  const screenshotPath = process.env.SKILL_MANAGER_SCREENSHOT_PATH;
  if (!screenshotPath) {
    console.error("[screenshot] SKILL_MANAGER_SCREENSHOT_PATH is required");
    app.exit(1);
    return;
  }

  try {
    await waitForRenderer(mainWindow);
    mainWindow.showInactive();
    await mainWindow.webContents.executeJavaScript(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    const image = await mainWindow.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 850 });
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    await fs.writeFile(screenshotPath, image.toPNG());
    app.exit(0);
  } catch (error) {
    console.error("[screenshot] failed", error);
    app.exit(1);
  }
}

async function waitForRenderer(mainWindow: BrowserWindow): Promise<void> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const ready = await mainWindow.webContents.executeJavaScript(
      'Boolean(document.querySelector(".skill-title"))'
    );
    if (ready) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("Renderer did not finish loading in time");
}

async function runSmoke(mainWindow: BrowserWindow): Promise<void> {
  const localSource = process.env.SKILL_MANAGER_SMOKE_LOCAL_SOURCE || "";
  const script = `
    (async () => {
      const api = window.skillManager;
      if (!api || !api.skills || !api.config || !api.tools) {
        throw new Error("preload API was not exposed");
      }

      const config = await api.config.get();
      const tools = await api.tools.list();
      const initialSkills = await api.skills.list();
      const adopted = await api.skills.adoptExisting({});
      const afterAdopt = await api.skills.list();

      const localResult = await api.skills.installFromLocalPath({ path: ${JSON.stringify(localSource)} });
      let selectedLocalResult = null;
      if (localResult.needsSelection) {
        selectedLocalResult = await api.skills.installFromLocalPath({
          path: ${JSON.stringify(localSource)},
          selectedSkillIds: localResult.candidates.map((candidate) => candidate.id)
        });
      }

      let afterImport = await api.skills.list();
      if (!afterImport.length) {
        throw new Error(JSON.stringify({
          message: "expected at least one skill after adopt/import",
          config,
          tools,
          adopted,
          afterAdopt,
          localResult,
          selectedLocalResult,
          afterImport
        }));
      }

      const firstSkill = afterImport[0];
      await api.skills.setToolEnabled({ skillId: firstSkill.id, toolId: "codex", enabled: true });
      await api.skills.setToolEnabled({ skillId: firstSkill.id, toolId: "claude-code", enabled: true });

      const batchResult = await api.skills.batchSetToolEnabled({
        skillIds: afterImport.map((skill) => skill.id),
        toolIds: ["codex", "claude-code"],
        enabled: false
      });

      await api.config.update({ ...config, linkMode: "copy" });
      afterImport = await api.skills.list();
      await api.skills.setToolEnabled({ skillId: afterImport[0].id, toolId: "codex", enabled: true });

      const markdown = await api.skills.readMarkdown(afterImport[0].id);
      if (!markdown.includes("SKILL") && !markdown.includes("#")) {
        throw new Error("markdown preview returned unexpected content");
      }

      const deleteTargetId = afterImport[0].id;
      const deleteResult = await api.skills.delete({ skillIds: [deleteTargetId] });
      if (deleteResult.deletedCount !== 1) {
        throw new Error("delete smoke failed");
      }
      const afterDelete = await api.skills.list();
      if (afterDelete.some((skill) => skill.id === deleteTargetId)) {
        throw new Error("deleted skill still appears in list");
      }

      return {
        configHub: config.hubDir,
        toolCount: tools.length,
        initialSkillCount: initialSkills.length,
        adoptedCount: adopted.adopted.length,
        afterAdoptCount: afterAdopt.length,
        afterImportCount: afterImport.length,
        afterDeleteCount: afterDelete.length,
        batchFailedCount: batchResult.failedCount,
        deleteFailedCount: deleteResult.failedCount,
        markdownLength: markdown.length
      };
    })()
  `;

  try {
    const result = await mainWindow.webContents.executeJavaScript(script, true);
    console.log(`[smoke] ${JSON.stringify(result)}`);
    app.exit(0);
  } catch (error) {
    console.error("[smoke] failed", error);
    app.exit(1);
  }
}

app.whenReady().then(() => {
  configureApplicationMenu();
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
