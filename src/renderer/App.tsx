import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type {
  AppConfig,
  InstallFromGitHubRequest,
  InstallFromLocalPathRequest,
  InstallResult,
  MergeFileEntry,
  MergePreview,
  MergeResolutionChoice,
  SkillCandidate,
  SkillRecord,
  ToolConfig,
  ToolId
} from "../../electron/main/types";
import { diffLineClassName, displayLineNumber, formatDiffLineText, parseDiffLines } from "./diffView";
import { messageFromError } from "./errorMessage";

type SourceFilter = "all" | SkillRecord["sourceType"];
type CurrentView = "list" | "detail" | "settings";

type PendingInstall =
  | {
      kind: "github";
      request: InstallFromGitHubRequest;
      candidates: SkillCandidate[];
      selected: Set<string>;
      installSessionId?: string;
    }
  | {
      kind: "local";
      request: InstallFromLocalPathRequest;
      candidates: SkillCandidate[];
      selected: Set<string>;
      installSessionId?: string;
    };

const TOOL_IDS: ToolId[] = ["codex", "claude-code"];

function App(): ReactElement {
  const [config, setConfig] = useState<AppConfig | undefined>();
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [activeSkillId, setActiveSkillId] = useState<string | undefined>();
  const [currentView, setCurrentView] = useState<CurrentView>("list");
  const [activeMarkdown, setActiveMarkdown] = useState("");
  const [mergePreview, setMergePreview] = useState<MergePreview | undefined>();
  const [mergeResolutions, setMergeResolutions] = useState<Record<string, MergeResolutionChoice>>({});
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [githubUrl, setGithubUrl] = useState("");
  const [githubSubpath, setGithubSubpath] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [pendingInstall, setPendingInstall] = useState<PendingInstall | undefined>();
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const listScrollYRef = useRef(0);
  const pendingListScrollRestoreRef = useRef(false);

  const activeSkill = useMemo(
    () => skills.find((skill) => skill.id === activeSkillId),
    [activeSkillId, skills]
  );

  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return skills.filter((skill) => {
      const matchesSource = sourceFilter === "all" || skill.sourceType === sourceFilter;
      const matchesQuery =
        !normalizedQuery ||
        skill.id.toLowerCase().includes(normalizedQuery) ||
        skill.name.toLowerCase().includes(normalizedQuery) ||
        skill.description?.toLowerCase().includes(normalizedQuery);
      return matchesSource && matchesQuery;
    });
  }, [query, skills, sourceFilter]);

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    return window.skillManager.settings.onOpen(() => {
      setActiveSkillId(undefined);
      setActiveMarkdown("");
      setCurrentView("settings");
      window.scrollTo({ top: 0, left: 0 });
    });
  }, []);

  useEffect(() => {
    if (currentView !== "list" || !pendingListScrollRestoreRef.current) {
      return;
    }

    pendingListScrollRestoreRef.current = false;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: listScrollYRef.current, left: 0 });
    });
  }, [currentView]);

  useEffect(() => {
    if (!activeSkillId) {
      setActiveMarkdown("");
      setMergePreview(undefined);
      setMergeResolutions({});
      return;
    }
    setMergePreview(undefined);
    setMergeResolutions({});
    let alive = true;
    window.skillManager.skills
      .readMarkdown(activeSkillId)
      .then((content) => {
        if (alive) {
          setActiveMarkdown(content);
        }
      })
      .catch((reason) => {
        if (alive) {
          setActiveMarkdown(`读取失败: ${messageFromError(reason)}`);
        }
      });
    return () => {
      alive = false;
    };
  }, [activeSkillId]);

  async function refreshAll(): Promise<void> {
    await runTask(async () => {
      const [nextConfig, nextTools, nextSkills] = await Promise.all([
        window.skillManager.config.get(),
        window.skillManager.tools.list(),
        window.skillManager.skills.list()
      ]);
      setConfig(nextConfig);
      setTools(nextTools);
      setSkills(nextSkills);
    }, "已刷新");
  }

  async function runTask(
    task: () => Promise<void>,
    successMessage?: string,
    pendingMessage = "正在处理..."
  ): Promise<void> {
    setBusy(true);
    setBusyLabel(pendingMessage);
    setError("");
    setNotice(pendingMessage);
    try {
      await task();
      if (successMessage) {
        setNotice(successMessage);
      }
    } catch (reason) {
      setError(messageFromError(reason));
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  async function handleGitHubInstall(): Promise<void> {
    const request: InstallFromGitHubRequest = {
      url: githubUrl,
      subpath: githubSubpath || undefined
    };
    await runTask(async () => {
      const result = await window.skillManager.skills.installFromGitHub(request);
      await handleInstallResult(result, "github", request);
    }, undefined, "正在导入 GitHub skill，请稍等...");
  }

  async function handleLocalInstall(): Promise<void> {
    const request: InstallFromLocalPathRequest = { path: localPath };
    await runTask(async () => {
      const result = await window.skillManager.skills.installFromLocalPath(request);
      await handleInstallResult(result, "local", request);
    }, undefined, "正在导入本地 skill，请稍等...");
  }

  async function handleInstallResult(
    result: InstallResult,
    kind: PendingInstall["kind"],
    request: InstallFromGitHubRequest | InstallFromLocalPathRequest
  ): Promise<void> {
    if (result.needsSelection) {
      const alreadyInstalledCount = result.candidates.filter((candidate) => candidate.installed).length;
      setPendingInstall({
        kind,
        request: request as never,
        candidates: result.candidates,
        selected: new Set(
          result.candidates
            .filter((candidate) => !candidate.installed)
            .map((candidate) => candidate.id)
        ),
        installSessionId: result.installSessionId
      });
      setNotice(
        `找到 ${result.candidates.length} 个 skill${
          alreadyInstalledCount ? `，${alreadyInstalledCount} 个已安装` : ""
        }，请选择要安装的项`
      );
      return;
    }

    await refreshSkillsOnly();
    setNotice(formatInstallNotice(result));
  }

  async function confirmPendingInstall(): Promise<void> {
    if (!pendingInstall) {
      return;
    }

    const selectedSkillIds = Array.from(pendingInstall.selected);
    await runTask(async () => {
      const result =
        pendingInstall.kind === "github"
          ? await window.skillManager.skills.installFromGitHub({
              ...pendingInstall.request,
              selectedSkillIds,
              installSessionId: pendingInstall.installSessionId
            })
          : await window.skillManager.skills.installFromLocalPath({
              ...pendingInstall.request,
              selectedSkillIds,
              installSessionId: pendingInstall.installSessionId
            });
      setPendingInstall(undefined);
      await handleInstallResult(result, pendingInstall.kind, pendingInstall.request);
    }, undefined, "正在安装选中的 skill，请稍等...");
  }

  async function refreshSkillsOnly(): Promise<void> {
    const nextSkills = await window.skillManager.skills.list();
    setSkills(nextSkills);
  }

  async function toggleSkillTool(skill: SkillRecord, toolId: ToolId, enabled: boolean): Promise<void> {
    await runTask(async () => {
      const nextSkills = await window.skillManager.skills.setToolEnabled({
        skillId: skill.id,
        toolId,
        enabled
      });
      setSkills(nextSkills);
    }, enabled ? `已启用 ${skill.id}` : `已禁用 ${skill.id}`);
  }

  async function batchToggle(toolIds: ToolId[], enabled: boolean): Promise<void> {
    const skillIds = selectedSkillIds.size
      ? Array.from(selectedSkillIds)
      : filteredSkills.map((skill) => skill.id);

    await runTask(async () => {
      const result = await window.skillManager.skills.batchSetToolEnabled({
        skillIds,
        toolIds,
        enabled
      });
      setSkills(result.skills);
      const suffix = result.failedCount ? `，${result.failedCount} 项失败` : "";
      setNotice(`已处理 ${result.appliedCount} 项，跳过 ${result.skippedCount} 项${suffix}`);
    });
  }

  async function adoptExisting(): Promise<void> {
    await runTask(async () => {
      const result = await window.skillManager.skills.adoptExisting({});
      await refreshSkillsOnly();
      const skipped = result.skipped.length ? `，跳过 ${result.skipped.length} 项` : "";
      setNotice(`已接管 ${result.adopted.length} 个现有 skill${skipped}`);
    }, undefined, "正在接管现有 skills，请稍等...");
  }

  async function deleteSkills(skillIds: string[]): Promise<void> {
    if (!skillIds.length) {
      return;
    }

    const confirmed = window.confirm(
      `确定要删除 ${skillIds.length} 个已安装 skill 吗？\n\n会删除中心仓库中的 skill，并清理本应用创建的 Codex/Claude 链接或副本。非托管同名目录会保留。`
    );
    if (!confirmed) {
      return;
    }

    await runTask(async () => {
      const result = await window.skillManager.skills.delete({ skillIds });
      setSkills(result.skills);
      setSelectedSkillIds((current) => {
        const next = new Set(current);
        for (const skillId of skillIds) {
          next.delete(skillId);
        }
        return next;
      });
      if (activeSkillId && skillIds.includes(activeSkillId)) {
        setActiveSkillId(undefined);
        setActiveMarkdown("");
        setCurrentView("list");
      }
      const suffix = result.failedCount ? `，${result.failedCount} 项需要注意` : "";
      setNotice(`已删除 ${result.deletedCount} 个 skill${suffix}`);
    }, undefined, "正在删除 skill，请稍等...");
  }

  async function deleteSelectedSkills(): Promise<void> {
    await deleteSkills(Array.from(selectedSkillIds));
  }

  async function loadMergePreview(skill: SkillRecord, toolId: ToolId): Promise<void> {
    await runTask(async () => {
      const preview = await window.skillManager.skills.getMergePreview({
        skillId: skill.id,
        toolId
      });
      setMergePreview(preview);
      setMergeResolutions(
        Object.fromEntries(
          preview.files.map((file) => [file.path, preferredMergeResolution(file)])
        )
      );
      setNotice(`找到 ${preview.dirtyFileCount} 个可回流文件`);
    }, undefined, "正在生成合并预览...");
  }

  async function applyMergePreview(): Promise<void> {
    if (!mergePreview) {
      return;
    }

    await runTask(async () => {
      const result = await window.skillManager.skills.applyMerge({
        skillId: mergePreview.skillId,
        toolId: mergePreview.toolId,
        resolutions: Object.entries(mergeResolutions).map(([filePath, resolution]) => ({
          path: filePath,
          resolution
        }))
      });
      setSkills(result.skills);
      setMergePreview(undefined);
      setMergeResolutions({});
      setNotice(
        `已回流 ${result.appliedCount} 个文件，保留 ${result.skippedCount} 个中心版本，刷新 ${result.refreshedCopyCount} 个副本`
      );
    }, undefined, "正在合并回中心仓库...");
  }

  function updateMergeResolution(filePath: string, resolution: MergeResolutionChoice): void {
    setMergeResolutions((current) => ({
      ...current,
      [filePath]: resolution
    }));
  }

  async function chooseLocalDirectory(): Promise<void> {
    const selected = await window.skillManager.dialog.selectDirectory();
    if (selected) {
      setLocalPath(selected);
    }
  }

  async function chooseToolSkillsDirectory(toolId: ToolId): Promise<void> {
    const selected = await window.skillManager.dialog.selectDirectory();
    if (selected) {
      updateToolSkillsPath(toolId, selected);
    }
  }

  function updateToolSkillsPath(toolId: ToolId, selected: string): void {
    if (!config) {
      return;
    }

    const tool = config.tools[toolId];
    setConfig({
      ...config,
      tools: {
        ...config.tools,
        [toolId]: {
          ...tool,
          skillsPath: selected
        }
      }
    });
  }

  async function saveSettings(): Promise<void> {
    if (!config) {
      return;
    }
    await runTask(async () => {
      const nextConfig = await window.skillManager.config.update(config);
      setConfig(nextConfig);
      setTools(Object.values(nextConfig.tools));
      await refreshSkillsOnly();
    }, "设置已保存");
  }

  function toggleSelected(skillId: string): void {
    setSelectedSkillIds((current) => {
      const next = new Set(current);
      if (next.has(skillId)) {
        next.delete(skillId);
      } else {
        next.add(skillId);
      }
      return next;
    });
  }

  function toggleAllVisible(checked: boolean): void {
    setSelectedSkillIds(checked ? new Set(filteredSkills.map((skill) => skill.id)) : new Set());
  }

  function openSkillDetail(skillId: string): void {
    listScrollYRef.current = window.scrollY;
    setActiveSkillId(skillId);
    setCurrentView("detail");
    window.scrollTo({ top: 0, left: 0 });
  }

  function returnToList(): void {
    pendingListScrollRestoreRef.current = true;
    setCurrentView("list");
  }

  function renderSettings(): ReactElement | null {
    if (!config) {
      return null;
    }

    return (
      <div className="settings-box">
        <h2>目录设置</h2>
        <p className="settings-note">
          默认会根据系统用户目录自动检测 Codex 和 Claude Code 的 skills 目录，也可以在这里手动选择。
        </p>
        <label>
          中心仓库
          <input
            value={config.hubDir}
            onChange={(event) => setConfig({ ...config, hubDir: event.target.value })}
          />
        </label>
        <label>
          启用方式
          <select
            value={config.linkMode}
            onChange={(event) =>
              setConfig({ ...config, linkMode: event.target.value as AppConfig["linkMode"] })
            }
          >
            <option value="link-preferred">链接优先，失败复制</option>
            <option value="copy">始终复制</option>
          </select>
        </label>
        <div className="settings-section">
          <h3>工具 Skills 目录</h3>
          {TOOL_IDS.map((toolId) => {
            const tool = config.tools[toolId];
            return (
              <div className="settings-field" key={toolId}>
                <label htmlFor={`${toolId}-skills-path`}>{tool.name}</label>
                <div className="field-row">
                  <input
                    id={`${toolId}-skills-path`}
                    value={tool.skillsPath}
                    onChange={(event) => updateToolSkillsPath(toolId, event.target.value)}
                  />
                  <button type="button" onClick={() => void chooseToolSkillsDirectory(toolId)} disabled={busy}>
                    手动选择
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={saveSettings} disabled={busy}>保存设置</button>
      </div>
    );
  }

  function renderMergePanel(skill: SkillRecord): ReactElement {
    const mergeableStates = TOOL_IDS
      .map((toolId) => ({ toolId, state: skill.enabledByTool[toolId] }))
      .filter(({ state }) => state.canMergeBack);

    return (
      <section className="merge-panel">
        <div className="section-heading">
          <div>
            <h2>合并回中心仓库</h2>
            <p className="settings-note">
              只会处理本应用管理的复制副本；链接模式已经直接指向中心仓库。
            </p>
          </div>
          {mergePreview && (
            <button className="primary" onClick={applyMergePreview} disabled={busy || mergePreview.files.length === 0}>
              确认合并
            </button>
          )}
        </div>

        <div className="merge-actions">
          {mergeableStates.length ? (
            mergeableStates.map(({ toolId, state }) => (
              <button
                key={toolId}
                onClick={() => void loadMergePreview(skill, toolId)}
                disabled={busy}
              >
                预览 {toolName(toolId)} {state.managed ? "副本" : "目录"}（{state.dirtyFileCount}）
              </button>
            ))
          ) : (
            <span className="muted">当前没有可回流的工具目录。</span>
          )}
        </div>

        {mergePreview && renderMergePreview(mergePreview)}
      </section>
    );
  }

  function renderMergePreview(preview: MergePreview): ReactElement {
    const diffFiles = preview.files.filter((file) => file.diff);

    return (
      <div className="merge-preview">
        <div className="merge-summary">
          <span>{toolName(preview.toolId)}</span>
          <span>{preview.dirtyFileCount} 个文件</span>
          <span>{diffFiles.length} 个有文本差异</span>
          <span>{preview.conflictCount} 个冲突</span>
          <span>{preview.binaryCount} 个二进制</span>
        </div>
        {diffFiles.length ? (
          diffFiles.map((file) => (
            <MergeFileCard
              key={file.path}
              file={file}
              toolId={preview.toolId}
              resolution={mergeResolutions[file.path] ?? preferredMergeResolution(file)}
              onResolutionChange={updateMergeResolution}
            />
          ))
        ) : (
          <p className="settings-note">当前没有可展示的文本差异。</p>
        )}
      </div>
    );
  }

  if (currentView === "settings") {
    return (
      <main className="app-shell detail-shell">
        <section className="detail-page settings-page">
          <div className="detail-header">
            <div className="detail-title">
              <p className="eyebrow">设置</p>
              <h2>目录与启用方式</h2>
            </div>
            <button onClick={returnToList}>返回列表</button>
          </div>
          {renderSettings()}
        </section>
      </main>
    );
  }

  if (currentView === "detail" && activeSkill) {
    return (
      <main className="app-shell detail-shell">
        <section className="detail-page">
          <div className="detail-header">
            <div className="detail-title">
              <p className="eyebrow">Skill 详情</p>
              <h2>{activeSkill.name}</h2>
            </div>
            <button onClick={returnToList}>返回列表</button>
          </div>

          <div className="detail-meta">
            <strong>{activeSkill.name}</strong>
            <code>{activeSkill.path}</code>
            <span className={`sync-badge sync-${activeSkill.syncState}`}>
              {syncStateLabel(activeSkill.syncState, activeSkill.dirtyFileCount)}
            </span>
            {activeSkill.sourceUrl && (
              <a href={activeSkill.sourceUrl} target="_blank" rel="noreferrer">
                {activeSkill.sourceUrl}
              </a>
            )}
          </div>
          {renderMergePanel(activeSkill)}
          <pre className="markdown-preview">{activeMarkdown}</pre>
          {renderSettings()}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Codex + Claude Code</p>
          <h1>Skill 桌面管理器 V0.2</h1>
        </div>
        <div className="topbar-actions">
          <button onClick={refreshAll} disabled={busy}>刷新</button>
          <button className="primary" onClick={adoptExisting} disabled={busy}>
            接管现有 Skills
          </button>
        </div>
      </header>

      <section className="status-strip">
        {tools.map((tool) => (
          <div className="tool-pill" key={tool.id}>
            <strong>{tool.name}</strong>
            <span>{tool.detected ? "目录已检测" : "目录未创建"}</span>
            <code>{tool.skillsPath}</code>
          </div>
        ))}
      </section>

      {(notice || error) && (
        <section className={error ? "message error" : busy ? "message loading" : "message"}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {error || notice}
        </section>
      )}

      <section className="import-grid">
            <div className="panel">
              <h2>GitHub 导入</h2>
              <div className="field-row">
                <input
                  value={githubUrl}
                  onChange={(event) => setGithubUrl(event.target.value)}
                  placeholder="https://github.com/owner/repo 或 /tree/main/path"
                />
                <input
                  className="short-input"
                  value={githubSubpath}
                  onChange={(event) => setGithubSubpath(event.target.value)}
                  placeholder="可选 subpath"
                />
                <button className="primary" onClick={handleGitHubInstall} disabled={busy || !githubUrl.trim()}>
                  {busyLabel.includes("GitHub") ? "正在导入..." : "导入"}
                </button>
              </div>
            </div>
            <div className="panel">
              <h2>本地导入</h2>
              <div className="field-row">
                <input
                  value={localPath}
                  onChange={(event) => setLocalPath(event.target.value)}
                  placeholder="选择或粘贴 skill 目录"
                />
                <button onClick={chooseLocalDirectory} disabled={busy}>选择</button>
                <button className="primary" onClick={handleLocalInstall} disabled={busy || !localPath.trim()}>
                  {busyLabel.includes("本地") ? "正在导入..." : "导入"}
                </button>
              </div>
            </div>
          </section>

          {pendingInstall && (
            <section className="panel candidate-panel">
              <div className="section-heading">
                <h2>选择要安装的 Skills</h2>
                <button className="primary" onClick={confirmPendingInstall} disabled={busy || pendingInstall.selected.size === 0}>
                  {busyLabel.includes("安装选中") || busyLabel.includes("选中的") ? "安装中..." : "安装选中"}
                </button>
              </div>
              <div className="candidate-list">
                {pendingInstall.candidates.map((candidate) => (
                  <label
                    key={`${candidate.id}-${candidate.relativePath}`}
                    className={`candidate-item${candidate.installed ? " installed" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={!candidate.installed && pendingInstall.selected.has(candidate.id)}
                      disabled={candidate.installed}
                      onChange={(event) => {
                        setPendingInstall((current) => {
                          if (!current) return current;
                          const next = new Set(current.selected);
                          if (event.target.checked) next.add(candidate.id);
                          else next.delete(candidate.id);
                          return { ...current, selected: next };
                        });
                      }}
                    />
                    <span>
                      <strong>
                        {candidate.name}
                        {candidate.installed && <em className="candidate-badge">已安装</em>}
                      </strong>
                      <small>{candidate.relativePath}</small>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="workspace">
            <div className="skills-pane">
              <div className="toolbar">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称、ID、描述"
                />
                <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}>
                  <option value="all">全部来源</option>
                  <option value="hub">中心仓库</option>
                  <option value="github">GitHub</option>
                  <option value="local">本地</option>
                  <option value="adopted">接管</option>
                </select>
              </div>

              <div className="batchbar">
                <span>{selectedSkillIds.size ? `已选 ${selectedSkillIds.size}` : `显示 ${filteredSkills.length}`}</span>
                <button onClick={() => batchToggle(["codex"], true)} disabled={busy || filteredSkills.length === 0}>
                  启用到 Codex
                </button>
                <button onClick={() => batchToggle(["claude-code"], true)} disabled={busy || filteredSkills.length === 0}>
                  启用到 Claude
                </button>
                <button onClick={() => batchToggle(TOOL_IDS, true)} disabled={busy || filteredSkills.length === 0}>
                  全部启用
                </button>
                <button onClick={() => batchToggle(TOOL_IDS, false)} disabled={busy || filteredSkills.length === 0}>
                  全部禁用
                </button>
                <button className="danger" onClick={deleteSelectedSkills} disabled={busy || selectedSkillIds.size === 0}>
                  删除已选项
                </button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={filteredSkills.length > 0 && filteredSkills.every((skill) => selectedSkillIds.has(skill.id))}
                          onChange={(event) => toggleAllVisible(event.target.checked)}
                        />
                      </th>
                      <th>Skill</th>
                      <th>来源</th>
                      <th>同步</th>
                      <th>Codex</th>
                      <th>Claude Code</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSkills.map((skill) => (
                      <tr
                        key={skill.id}
                        className={skill.id === activeSkillId ? "active-row" : ""}
                      >
                        <td onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedSkillIds.has(skill.id)}
                            onChange={() => toggleSelected(skill.id)}
                          />
                        </td>
                        <td className="skill-detail-cell" onClick={() => openSkillDetail(skill.id)}>
                          <div className="skill-title">{skill.name}</div>
                          <code>{skill.id}</code>
                          {skill.description && <p>{skill.description}</p>}
                        </td>
                        <td>
                          <span className={`source-badge source-${skill.sourceType}`}>
                            {sourceLabel(skill.sourceType)}
                          </span>
                        </td>
                        <td>
                          <span className={`sync-badge sync-${skill.syncState}`}>
                            {syncStateLabel(skill.syncState, skill.dirtyFileCount)}
                          </span>
                        </td>
                        {TOOL_IDS.map((toolId) => (
                          <td key={toolId}>
                            <ToolToggle
                              skill={skill}
                              toolId={toolId}
                              disabled={busy}
                              onToggle={toggleSkillTool}
                            />
                          </td>
                        ))}
                        <td onClick={(event) => event.stopPropagation()}>
                          <button className="danger table-action-button" onClick={() => void deleteSkills([skill.id])} disabled={busy}>
                            删除
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!filteredSkills.length && (
                      <tr>
                        <td colSpan={7} className="empty-cell">
                          没有找到 skill。可以从 GitHub、本地目录导入，或先接管现有工具目录。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
    </main>
  );
}

function ToolToggle({
  skill,
  toolId,
  disabled,
  onToggle
}: {
  skill: SkillRecord;
  toolId: ToolId;
  disabled: boolean;
  onToggle: (skill: SkillRecord, toolId: ToolId, enabled: boolean) => Promise<void>;
}): ReactElement {
  const state = skill.enabledByTool[toolId];
  const isConflict = state.status === "conflict";
  return (
    <div className="toggle-cell">
      <label className="switch">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={disabled || isConflict}
          onChange={(event) => void onToggle(skill, toolId, event.target.checked)}
        />
        <span />
      </label>
      <small className={`state-label state-${state.status}`}>
        {stateLabel(state.status)}
      </small>
      {state.enabled && state.managed && (
        <small className={`sync-inline sync-${state.syncState}`}>
          {syncStateLabel(state.syncState, state.dirtyFileCount)}
        </small>
      )}
      {state.message && <small className="state-message">{state.message}</small>}
    </div>
  );
}

function MergeFileCard({
  file,
  toolId,
  resolution,
  onResolutionChange
}: {
  file: MergeFileEntry;
  toolId: ToolId;
  resolution: MergeResolutionChoice;
  onResolutionChange: (filePath: string, resolution: MergeResolutionChoice) => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const diffRows = parseDiffLines(file.diff ?? "");

  return (
    <article className={`merge-file merge-${file.status}`}>
      <div className="merge-file-header">
        <button
          type="button"
          className="merge-file-main"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <strong>{file.path}</strong>
          <span>{mergeStatusLabel(file)}</span>
        </button>
        <div className="merge-file-actions">
          <select
            value={resolution}
            onChange={(event) => onResolutionChange(file.path, event.target.value as MergeResolutionChoice)}
          >
            {file.resolutionOptions.map((option) => (
              <option value={option} key={option}>
                {resolutionLabel(option, toolId)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {expanded && (
        <div className="merge-diff" role="table" aria-label={`${file.path} 差异`}>
          {diffRows.map((row) => (
            <div className={`diff-row ${diffLineClassName(row)}`} key={row.key} role="row">
              <span className="diff-line-number">{displayLineNumber(row)}</span>
              <code className="diff-line-code">{formatDiffLineText(row)}</code>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function preferredMergeResolution(file: MergeFileEntry): MergeResolutionChoice {
  return file.resolutionOptions.includes("copy") ? "copy" : file.defaultResolution;
}

function mergeStatusLabel(file: MergeFileEntry): string {
  if (file.requiresResolution) {
    return file.status === "conflict" ? "需要处理冲突" : "需要确认";
  }
  switch (file.status) {
    case "added":
      return "新增";
    case "deleted":
      return "删除";
    case "auto-merged":
      return "可自动合并";
    case "modified":
      return "修改";
    case "binary":
      return "二进制";
    default:
      return "冲突";
  }
}

function resolutionLabel(resolution: MergeResolutionChoice, toolId: ToolId): string {
  switch (resolution) {
    case "copy":
    case "auto":
      return `采用 ${toolName(toolId)}`;
    case "hub":
      return "保留中心";
    default:
      return `采用 ${toolName(toolId)}`;
  }
}

function sourceLabel(source: SkillRecord["sourceType"]): string {
  switch (source) {
    case "github":
      return "GitHub";
    case "local":
      return "本地";
    case "adopted":
      return "接管";
    default:
      return "中心";
  }
}

function toolName(toolId: ToolId): string {
  return toolId === "codex" ? "Codex" : "Claude Code";
}

function syncStateLabel(state: SkillRecord["syncState"], dirtyFileCount: number): string {
  switch (state) {
    case "dirty":
      return `待回流 ${dirtyFileCount}`;
    case "linked":
      return "软链接同步";
    case "unknown":
      return "未知";
    case "unmanaged":
      return dirtyFileCount ? `可回流 ${dirtyFileCount}` : "非托管";
    default:
      return "已同步";
  }
}

function formatInstallNotice(result: InstallResult): string {
  const alreadyInstalledCount = result.alreadyInstalled.length;
  if (!result.installed.length && alreadyInstalledCount && !result.failures.length) {
    return `${alreadyInstalledCount} 个 skill 已安装，无需重复安装`;
  }

  const parts: string[] = [];
  if (result.installed.length) {
    parts.push(`新安装 ${result.installed.length} 个 skill`);
  }
  if (alreadyInstalledCount) {
    parts.push(`${alreadyInstalledCount} 个已安装`);
  }
  if (result.failures.length) {
    parts.push(`${result.failures.length} 项失败`);
  }
  return parts.length ? parts.join("，") : "没有需要安装的 skill";
}

function stateLabel(status: string): string {
  switch (status) {
    case "enabled":
      return "已启用";
    case "conflict":
      return "冲突";
    case "broken":
      return "断链";
    default:
      return "未启用";
  }
}

export default App;
