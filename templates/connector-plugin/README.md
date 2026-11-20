# 连接器插件脚手架

把业务系统(ERP/CRM/OA/工单)接入 pi 桌面端的最快路径。复制本目录,全局替换 `NAME` 为你的系统标识(如 `crm`)。

## 你需要写的代码

| 位置 | 改什么 |
|---|---|
| `src/backend/index.ts` → `fetchRecords()` | 换成对目标系统 HTTP API 的调用 |
| `src/backend/index.ts` → `toListItems()` / `toToolText()` | 把 API 记录映射成面板行 / agent 文本 |
| `manifest.json` | id/名称/工具 schema/权限 |
| `ui/index.html` | 面板长什么样(模板里已经能跑,按需改) |

其余一切——握手、能力调用、面板路由、存储、生命周期、badge、错误上报——由 **SDK** 处理。

> `dist/main.mjs` 是**构建产物**,不要直接改它——改 `src/`,然后重新构建:

```bash
npm install                 # 装 @pi/plugin-sdk 和 esbuild
node scripts/build-backend.mjs
node scripts/typecheck.mjs  # 可选
```

> **面板就是一张网页。** 宿主负责把它装进窗口(`manifest` 里那个 `entry` 指向它),
> 你用 `window.piSDK` 跟自己的后端说话,不需要知道宿主是怎么装的。
>
> 面板 id 也不用你管:SDK 会自动盖在每条消息上。

## 前置:插件身份与权限

```jsonc
// manifest.json
{
  "id": "com.yourco.connector-crm",
  "permissions": [
    "storage",                       // 插件私有存储
    "network:api.crm.example"        // 出站到目标 API 域名
  ]
}
```

凭据流:插件首次运行时引导用户授权 → 用 `storage` 保存 token(插件私有、落盘)→ API 调用带 `Authorization`。宿主目前还没有系统钥匙串的 `secrets` 能力,声明 `secrets:<命名空间>` 不会生效。

## 工具即插即用

`contributes.tools` 里的 MCP JSON Schema 工具会自动注册进 agent 会话——用户对 agent 说"查一下上周的订单",agent 直接调 `crm_query`,结果回流到对话;面板和工具共享同一份 backend 状态。

## 安装与调试

```bash
# 构建后端
node scripts/build-backend.mjs

# 手动安装到用户插件目录（重启应用后生效）
cp -r manifest.json dist ui ~/.pi/agent/plugins/com.yourco.connector-crm/

# 或者直接在 PiWork 里把本目录当开发根（改代码立刻生效）
PI_DEV_PLUGINS="$PWD" pnpm dev:desktop:plugins    # 在 PiWork 仓库里执行
```

## 发布

插件是独立的发布单位：给自己的插件建一个 GitHub 仓库，把任意官方插件仓库里的
`scripts/release.mjs` 和 `.github/workflows/release.yml` 复制过来，改
`manifest.json` 的 `version`，推 tag `v<version>` —— Release 会同时带上
`<id>-<version>.zip` 和 `index.json`（含 sha256 与固定下载地址）。
之后向 [PiWork-Registry](https://github.com/PiWorkAgent/PiWork-Registry) 提一个 PR
登记 `sources.json`，下一次索引刷新就会出现在插件中心。

## 参考

- 真实例子：[PiWork-Plugin-Tasks](https://github.com/PiWorkAgent/PiWork-Plugin-Tasks) —— 面板 + 工具 + 私有存储 + 通知权限齐全，最接近连接器
- 框架文档：[plugin-dev-guide.md](https://github.com/PiWorkAgent/PiWork-Plugin-Docs/blob/main/docs/plugin-dev-guide.md)
