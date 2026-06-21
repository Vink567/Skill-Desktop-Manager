# Skill Desktop Manager

一个用于集中管理 Codex 与 Claude Code skills 的桌面应用。它可以扫描、导入、启用、禁用和删除本地 skills，也支持从 GitHub 仓库安装 skill 包。

![Skill Desktop Manager screenshot](docs/app-screenshot.png)

## 功能

- 统一查看 Codex 和 Claude Code 的 skill 状态。
- 从 GitHub URL 或本地目录导入 skills。
- 对单个或批量 skills 启用/禁用 Codex、Claude Code 集成。
- 查看 skill 元数据和 `SKILL.md` 内容。
- 手动设置工具的 skills 目录，适配不同本地环境。
- 删除已安装 skills，并清理本应用创建的链接或副本。

## 快速开始

```bash
npm install
npm run dev
```

## 常用命令

```bash
npm test          # 运行 Vitest 测试
npm run build     # 类型检查并构建 Electron 应用
npm run smoke     # 构建后运行 Electron 冒烟测试
npm run screenshot # 重新生成 README 截图
npm run dist      # 生成 Windows 安装包
```

## 项目结构

- `electron/main`：主进程、配置、扫描、安装、删除和工具链接逻辑。
- `electron/preload`：向 renderer 暴露受控 IPC API。
- `src/renderer`：React 桌面界面。
- `tests`：服务逻辑和 UI 结构测试。
- `scripts`：冒烟测试与截图生成脚本。

## 说明

仓库只保存源码、测试、配置和锁文件。`node_modules`、`out`、`release*`、日志和临时构建产物已通过 `.gitignore` 排除。
