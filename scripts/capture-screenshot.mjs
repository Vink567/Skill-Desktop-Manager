import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultScreenshotPath = path.join(projectRoot, "docs", "app-screenshot.png");

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "skill-manager-screenshot-"));
const homeDir = path.join(tempRoot, "home");
const screenshotPath = path.resolve(process.argv[2] || defaultScreenshotPath);

try {
  await seedFakeHome(homeDir);
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  await fs.mkdir(path.join(homeDir, ".electron-user-data"), { recursive: true });
  await runElectronCapture(homeDir, screenshotPath);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

function runElectronCapture(homeDir, screenshotPath) {
  return new Promise((resolve, reject) => {
    const userDataDir = path.join(homeDir, ".electron-user-data");
    const child = spawn(electronPath, [
      `--user-data-dir=${userDataDir}`,
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--no-sandbox",
      path.join(projectRoot, "out", "main", "index.js")
    ], {
      cwd: projectRoot,
      env: {
        ...process.env,
        SKILL_MANAGER_HOME: homeDir,
        SKILL_MANAGER_SCREENSHOT_PATH: screenshotPath,
        SKILL_MANAGER_SCREENSHOT_USER_DATA_DIR: userDataDir
      },
      stdio: "inherit",
      windowsHide: true
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Screenshot capture failed with exit code ${code}`));
      }
    });
  });
}

async function seedFakeHome(homeDir) {
  await fs.mkdir(path.join(homeDir, ".codex", "skills"), { recursive: true });
  await fs.mkdir(path.join(homeDir, ".claude", "skills"), { recursive: true });

  const hubDir = path.join(homeDir, ".skill-desktop-manager", "skills");
  await writeSkill(hubDir, {
    id: "openai-docs",
    name: "OpenAI Docs",
    description: "Build with current OpenAI API and product documentation.",
    sourceType: "github",
    sourceUrl: "https://github.com/example/skills",
    revision: "demo"
  });
  await writeSkill(hubDir, {
    id: "frontend-review",
    name: "Frontend Review",
    description: "Review React UI for accessibility, missing states, and regressions.",
    sourceType: "adopted"
  });
  await writeSkill(hubDir, {
    id: "skill-installer",
    name: "Skill Installer",
    description: "Install Codex skills from curated lists or GitHub repositories.",
    sourceType: "hub"
  });
  await writeSkill(hubDir, {
    id: "twitter-writer",
    name: "Twitter Writer",
    description: "Draft Chinese X posts, threads, hooks, and publishing checks.",
    sourceType: "local"
  });
}

async function writeSkill(hubDir, skill) {
  const skillDir = path.join(hubDir, skill.id);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n# ${skill.name}\n\n${skill.description}\n`,
    "utf8"
  );

  await fs.writeFile(
    path.join(skillDir, ".skill-desktop-manager.json"),
    `${JSON.stringify(
      {
        app: "skill-desktop-manager",
        sourceType: skill.sourceType,
        sourceUrl: skill.sourceUrl,
        revision: skill.revision,
        installedAt: "2026-06-21T00:00:00.000Z"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}
