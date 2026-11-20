# PiWork

基于 Electron + React 的 AI 编程助手桌面应用，提供 Web 和桌面双端体验。

## 下载

[![下载最新版本](https://img.shields.io/badge/下载-最新版本-2ea44f?style=for-the-badge)](https://github.com/PiWorkAgent/PiWork/releases/latest)

点上面按钮（或直接打开 [Releases](https://github.com/PiWorkAgent/PiWork/releases/latest)），按平台取安装包：

| 平台 | 安装包 |
|------|--------|
| macOS（Apple 芯片） | `.dmg`，文件名带 `-arm64` |
| macOS（Intel） | `.dmg`，文件名不带架构后缀 |
| Windows（x64） | `.exe` |
| Linux（x64） | `.AppImage` 或 `.deb` |

> 产物暂未做 Developer ID 签名与公证（macOS 安装包内已做 ad-hoc 签名）。macOS 首次打开若提示「无法验证开发者」，打开「系统设置 → 隐私与安全性」，点「仍要打开」；若提示「已损坏，无法打开」（浏览器下载的旧版本可能这样报），先在终端执行 `xattr -dr com.apple.quarantine /Applications/PiWork.app` 再打开。Windows 会出现 SmartScreen 提示，选「更多信息」→「仍要运行」。

> macOS 端要求 macOS 13（Ventura）及以上。

## 主要功能

- **AI 对话** — 多轮对话式编程助手，支持思考过程展示和工具调用可视化
- **工作空间管理** — 创建和管理多个项目工作空间
- **会话管理** — 支持会话分组、历史查看和会话切换
- **文件浏览** — 内置文件树，支持文件浏览和管理
- **文档预览** — 支持代码高亮、Markdown、PDF、Office 文档（.docx/.xlsx/.pptx）等格式预览
- **模型配置** — 支持多种 AI 提供商和模型选择，可自定义思考等级
- **斜杠命令** — 支持 `/help`、`/clear`、`/compact`、`/model`、`/config` 等命令
- **版本更新** — 设置 → 关于里检查更新，发现新版本时下载当前平台的安装包
- **浏览器自动化** — 支持通过 AI 驱动浏览器进行网页操作，实现自动化浏览与交互

## 功能演示

### AI 编程助手

![Demo](./assets/demo.gif)

### 浏览器自动化

![Browser Automation](./assets/chrome.gif)

## 技术栈

| 类别 | 技术 |
|------|------|
| **桌面框架** | Electron + electron-vite |
| **前端框架** | React 19 + TypeScript |
| **Web 构建** | Vite |
| **UI** | Tailwind CSS + shadcn/ui (Radix) |
| **状态管理** | Zustand + TanStack React Query |
| **代码编辑器** | Monaco Editor |
| **文档预览** | PDF.js、Mammoth (.docx)、SheetJS (.xlsx) |
| **构建工具** | Turborepo + pnpm workspace |
| **AI SDK** | @earendil-works/pi-coding-agent |

## 架构概览

项目采用 monorepo 架构，桌面端和 Web 端共享同一套 UI 组件，仅传输层不同：

```
桌面端:  Renderer (React) ──IPC──▶ Main Process ──▶ SDK ──▶ AI Backend
Web 端:  Browser (React)   ──HTTP─▶ Vite API Proxy ──▶ SDK ──▶ AI Backend
```

```
PiWork/
├── apps/
│   ├── desktop/          # Electron 桌面应用
│   │   ├── src/main/     # 主进程 (窗口管理、IPC 处理)
│   │   ├── src/preload/  # 预加载脚本 (contextBridge)
│   │   └── src/renderer/ # 渲染进程 (React)
│   └── web/              # Web 应用
├── packages/
│   ├── sdk-wrapper/      # SDK 封装层 (IPC/HTTP 双传输)
│   ├── types/            # 共享类型定义
│   ├── ui/               # 共享 UI 组件库 (布局、聊天、预览等)
│   └── plugin-sdk/       # 插件后端 SDK（npm: @weiqun789/plugin-sdk）
├── scripts/              # setup / dev-plugin / fetch-market 等辅助脚本
├── pnpm-workspace.yaml
└── turbo.json
```

插件不在本仓库：每个首方插件是独立仓库（见下文「插件」），通过插件市场安装和更新。

## 环境要求

- Node.js >= 20.19.0
- pnpm >= 9.0.0

## 快速开始

```bash
# 安装依赖并构建 packages/*/dist（应用直接引用这些产物）
pnpm setup

# 启动 Web 开发服务器 (localhost:5173)
# Web 端内置 API 代理，无需单独启动后端服务
pnpm dev:web

# 启动 Electron 桌面应用：插件从市场安装到 ~/.pi/agent/plugins
pnpm dev:desktop

# 改插件源码（插件已拆到独立仓库，见「插件」一节）
PI_DEV_PLUGINS=/path/to/PiWork-Plugin-Browser pnpm dev:desktop:plugins
```

`pnpm setup` 只做两件事：根依赖安装、根构建。插件依赖不再随本仓库安装。

## 插件

插件是**独立的发布单位**，不放在本仓库。每个插件一个 GitHub 仓库，发布产物是 GitHub Release 里的 `zip + index.json`；一个 registry 仓库把所有插件的 release 聚合成客户端读取的市场索引。

| 仓库 | 作用 |
| --- | --- |
| [PiWork-Plugin-Browser](https://github.com/PiWorkAgent/PiWork-Plugin-Browser) | 浏览器自动化 `com.pi.browser` |
| [PiWork-Plugin-Files](https://github.com/PiWorkAgent/PiWork-Plugin-Files) | 文件查看器 `com.pi.files` |
| [PiWork-Plugin-Tasks](https://github.com/PiWorkAgent/PiWork-Plugin-Tasks) | 日程本 `com.pi.tasks` |
| [PiWork-Plugin-Docs](https://github.com/PiWorkAgent/PiWork-Plugin-Docs) | 插件开发文档 `com.pi.devdocs`（开发指南也在这里） |
| [PiWork-Plugin-Diagnostics](https://github.com/PiWorkAgent/PiWork-Plugin-Diagnostics) | 运行诊断 `com.pi.diagnostics` |
| [PiWork-Registry](https://github.com/PiWorkAgent/PiWork-Registry) | 市场索引（官方 + 社区插件） |

客户端读的市场索引：

```
https://github.com/PiWorkAgent/PiWork-Registry/releases/latest/download/index.json
```

可以用环境变量 `PI_PLUGIN_REGISTRY`（或 `~/.pi/agent/plugins/_state.json` 的 `registry`）指向本地目录、镜像或私有市场。在线市场不可达时，应用回退到安装包内置的离线快照（只含官方插件）。

**两种启动方式，对应两种插件来源。** 插件的查找根按优先级 `dev > user` 解析：

- **`pnpm dev:desktop`（客户路径）**：不设开发根，应用只读 `~/.pi/agent/plugins/`。安装、更新、回滚都在插件中心走真实市场流程（sha256 校验、权限确认、原子替换）。这是验证"用户实际会看到什么"的方式。
- **`pnpm dev:desktop:plugins`（插件开发）**：把 `PI_DEV_PLUGINS` 指向某个插件仓库的 checkout，直接加载源码，改代码立刻生效。它会遮蔽用户目录里的同名副本，所以不能用来测安装/更新流程。
- `pnpm dev:desktop:raw` 是客户路径的历史别名，等价于 `pnpm dev:desktop`。

**开发一个插件**（以 Browser 为例）：

```bash
git clone https://github.com/PiWorkAgent/PiWork-Plugin-Browser
cd PiWork-Plugin-Browser && npm install && npm run build
PI_DEV_PLUGINS=/path/to/PiWork-Plugin-Browser pnpm dev:desktop:plugins   # 在 PiWork 仓库里执行
```

插件开发规范（manifest 字段、面板 API、后端 ctx、发布流程）见 [PiWork-Plugin-Docs](https://github.com/PiWorkAgent/PiWork-Plugin-Docs/blob/main/docs/plugin-dev-guide.md)，客户端里也可以通过「插件开发文档」面板阅读。插件后端依赖 SDK（npm 包 `@weiqun789/plugin-sdk`，插件里以别名 `@pi/plugin-sdk` 安装，构建时被打进 `dist/main.mjs`）。

## 命令参考

### 开发

| 命令 | 说明 |
|------|------|
| `pnpm setup` | 一键搭建：根安装 + 根构建 |
| `pnpm dev:web` | 启动 Web 应用 (localhost:5173) |
| `pnpm dev:desktop` | 启动 Electron 桌面应用（客户路径，读 `~/.pi/agent/plugins/`） |
| `pnpm dev:desktop:plugins` | 加载插件 checkout（需设 `PI_DEV_PLUGINS=/path/to/PiWork-Plugin-*`） |
| `pnpm dev:desktop:raw` | 客户路径的历史别名，等价于 `pnpm dev:desktop` |
| `pnpm diag:sessions` | 生成会话诊断报告 |

### 构建与打包

| 命令 | 说明 |
|------|------|
| `pnpm build` | 构建所有子包 |
| `pnpm pack:mac` | 打包 macOS 应用 (.dmg) |
| `pnpm pack:win` | 打包 Windows 应用 (.exe) |
| `pnpm pack:linux` | 打包 Linux 应用 (AppImage) |
| `pnpm pack:all` | 打包全平台 |

打包产物输出在 `apps/desktop/release/` 目录。

### 代码质量

| 命令 | 说明 |
|------|------|
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm test` | 跑测试（desktop 的 `node:test` + plugin-sdk 冒烟） |
| `pnpm format` | 代码格式化 (Prettier) |
| `pnpm clean` | 清理构建产物 |

## 发版

版本号真源是 `apps/desktop/package.json` 的 `version`。tag 必须与它完全一致，否则发布流程在打包前就会失败。

```bash
# 1. 改版本号（只改文件，不自动打 tag）
cd apps/desktop && npm version 0.2.0 --no-git-tag-version && cd ../..

# 2. 提交，打与版本号一致的 tag，push（tag 会触发发布）
git commit -am "发布 0.2.0"
git tag v0.2.0
git push origin HEAD --tags
```

push tag 后 `.github/workflows/release.yml` 依次执行：

1. **verify** —— 与 CI 相同的 build / typecheck / test，不通过就停在这里；
2. **build** —— macOS（arm64 + x64）、Windows x64、Linux x64 各出一份安装包；
3. **publish** —— 创建 GitHub Release，把四个平台的产物挂到 Assets，正文自动生成。

tag 里带 `-`（如 `v0.2.0-beta.1`）会自动标成 prerelease；产物暂未做 Developer ID 签名与公证，macOS 包只在打包后做了 ad-hoc 签名（`apps/desktop/scripts/adhoc-sign-mac.cjs`），所以下载后首次打开仍需在「隐私与安全性」里放行一次。拿到 Apple 开发者证书后，删除 `electron-builder.yml` 里的 `mac.identity: null` 并启用 notarization 即可去掉这一步。
