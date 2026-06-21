import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "skill-manager-smoke-"));
const fakeHome = path.join(tempRoot, "home");
const localSource = path.join(tempRoot, "local-source");

try {
  await seedFakeHome(fakeHome);
  await seedLocalSource(localSource);
  const result = await runElectronSmoke(fakeHome, localSource);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.code !== 0) {
    throw new Error(`Electron smoke failed with exit code ${result.code}`);
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function seedFakeHome(homeDir) {
  await writeSkill(path.join(homeDir, ".codex", "skills", "adopt-me"), "adopt-me", "Adopted from Codex");
  await fs.mkdir(path.join(homeDir, ".claude", "skills"), { recursive: true });
}

async function seedLocalSource(sourceDir) {
  await writeSkill(path.join(sourceDir, "pack", "local-alpha"), "local-alpha", "Local import alpha");
  await writeSkill(path.join(sourceDir, "pack", "local-beta"), "local-beta", "Local import beta");
}

async function writeSkill(skillDir, name, description) {
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# SKILL ${name}\n\n${description}\n`,
    "utf8"
  );
}

function runElectronSmoke(homeDir, sourceDir) {
  return new Promise((resolve, reject) => {
    const userDataDir = path.join(homeDir, ".electron-user-data");
    const child = spawn(electronPath, [
      `--user-data-dir=${userDataDir}`,
      "--disable-gpu",
      "out/main/index.js"
    ], {
      cwd: projectRoot,
      env: {
        ...process.env,
        SKILL_MANAGER_SMOKE: "1",
        SKILL_MANAGER_HOME: homeDir,
        SKILL_MANAGER_SMOKE_LOCAL_SOURCE: sourceDir
      },
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
