import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : await findPackagedExecutable();

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "skill-manager-packaged-smoke-"));
const fakeHome = path.join(tempRoot, "home");
const localSource = path.join(tempRoot, "local-source");

try {
  await seedFakeHome(fakeHome);
  await seedLocalSource(localSource);
  const result = await runPackagedSmoke(fakeHome, localSource);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.code !== 0) {
    throw new Error(`Packaged app smoke failed with exit code ${result.code}`);
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function findPackagedExecutable() {
  const candidates = getExecutableCandidates();
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Packaged executable not found. Checked:\n${candidates.join("\n")}`);
}

function getExecutableCandidates() {
  if (process.platform === "win32") {
    return [path.join(projectRoot, "release", "win-unpacked", "Skill Desktop Manager.exe")];
  }

  if (process.platform === "darwin") {
    const executable = path.join("Skill Desktop Manager.app", "Contents", "MacOS", "Skill Desktop Manager");
    const nativeArchDir = process.arch === "arm64" ? "mac-arm64" : "mac";
    return [
      path.join(projectRoot, "release", nativeArchDir, executable),
      path.join(projectRoot, "release", "mac", executable),
      path.join(projectRoot, "release", "mac-x64", executable),
      path.join(projectRoot, "release", "mac-arm64", executable)
    ];
  }

  throw new Error(`Packaged smoke is not configured for ${process.platform}`);
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

function runPackagedSmoke(homeDir, sourceDir) {
  return new Promise((resolve, reject) => {
    const userDataDir = path.join(homeDir, ".electron-user-data");
    const child = spawn(executablePath, [
      `--user-data-dir=${userDataDir}`,
      "--disable-gpu"
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

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
