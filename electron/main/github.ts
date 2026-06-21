import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { cacheDir } from "./paths";

type GitRunner = (args: string[], cwd?: string) => Promise<string>;

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  repoUrl: string;
  ref?: string;
  subpath?: string;
}

export function parseGitHubUrl(input: string, explicitSubpath?: string): ParsedGitHubUrl {
  const normalized = input.trim();
  if (!normalized) {
    throw new Error("GitHub URL 不能为空");
  }

  const withProtocol = normalized.startsWith("git@")
    ? normalized
    : normalized.startsWith("http://") || normalized.startsWith("https://")
      ? normalized
      : `https://${normalized}`;

  if (withProtocol.startsWith("git@")) {
    const match = withProtocol.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
    if (!match) {
      throw new Error("仅支持 github.com 仓库地址");
    }
    return {
      owner: match[1],
      repo: match[2],
      repoUrl: `https://github.com/${match[1]}/${match[2]}.git`,
      subpath: normalizeSubpath(explicitSubpath)
    };
  }

  const url = new URL(withProtocol);
  if (url.hostname.toLowerCase() !== "github.com") {
    throw new Error("仅支持 github.com 仓库地址");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("GitHub URL 缺少 owner/repo");
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  let ref: string | undefined;
  let subpath = normalizeSubpath(explicitSubpath);

  if (parts[2] === "tree" && parts[3]) {
    ref = parts[3];
    subpath = subpath || normalizeSubpath(parts.slice(4).join("/"));
  }

  return {
    owner,
    repo,
    repoUrl: `https://github.com/${owner}/${repo}.git`,
    ref,
    subpath
  };
}

export async function cloneGitHubRepo(
  parsed: ParsedGitHubUrl,
  gitRunner: GitRunner = runGit
): Promise<{ dir: string; revision?: string }> {
  await fs.mkdir(cacheDir(), { recursive: true });
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cloneDir = createCloneDir(parsed);
    const args = buildCloneArgs(parsed, cloneDir, attempt === 1);

    try {
      await gitRunner(args);
      const revision = await getGitRevision(cloneDir, gitRunner);
      return { dir: cloneDir, revision };
    } catch (error) {
      lastError = error;
      await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => undefined);
      if (attempt === 0 && isTransientGitNetworkError(error)) {
        continue;
      }
      break;
    }
  }

  throw new Error(buildCloneErrorMessage(parsed.repoUrl, lastError));
}

function createCloneDir(parsed: ParsedGitHubUrl): string {
  return path.join(
    cacheDir(),
    `${parsed.owner}-${parsed.repo}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function buildCloneArgs(parsed: ParsedGitHubUrl, cloneDir: string, forceHttp11: boolean): string[] {
  const args = forceHttp11 ? ["-c", "http.version=HTTP/1.1"] : [];
  args.push("clone", "--depth", "1");
  if (parsed.ref) {
    args.push("--branch", parsed.ref);
  }
  args.push(parsed.repoUrl, cloneDir);
  return args;
}

async function getGitRevision(repoDir: string, gitRunner: GitRunner): Promise<string | undefined> {
  try {
    return (await gitRunner(["rev-parse", "HEAD"], repoDir)).trim();
  } catch {
    return undefined;
  }
}

function isTransientGitNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    /recv failure/i,
    /connection (?:was )?reset/i,
    /failed to connect/i,
    /could not connect/i,
    /could not resolve host/i,
    /timed? out/i,
    /early eof/i,
    /http\/2/i,
    /rpc failed/i,
    /tls connection/i,
    /the requested url returned error: 5\d\d/i
  ].some((pattern) => pattern.test(message));
}

function buildCloneErrorMessage(repoUrl: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    `GitHub 导入失败：无法克隆 ${repoUrl}。`,
    "已自动重试一次，并在重试时切换到 HTTP/1.1。",
    "如果仍然失败，请检查代理/VPN，或先用浏览器/命令行下载仓库后走“本地导入”。",
    `原始错误：${detail}`
  ].join("\n");
}

function runGit(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
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
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `git ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

function normalizeSubpath(value?: string): string | undefined {
  const trimmed = value?.trim().replace(/^\/+|\/+$/g, "");
  return trimmed || undefined;
}
