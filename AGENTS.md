# AGENTS.md

## 会话续接

- 继续本项目任务前，先读取项目根目录的 `HANDOFF.md` 一次。
- 若 `HANDOFF.md` 可能过期，用 `git status --short` 和 `git diff --stat` 核对后再继续。

## 项目概览

知识库文件 API 服务：把 `active` 目录中的文件通过 HTTP API 暴露给 FastGPT「API 文件库」拉取。
Next.js 16 全栈应用（App Router + Route Handlers），底层文件操作用 `fs/promises` 极简实现，
采用三区结构、无独立缓存层：
- `staging`：第三方上传待审（`POST /api/open/upload`）
- 审核：`POST /api/admin/confirm` 先调 `syncToVolcanoAPI`（预留火山 mock）再 `fs.rename` 到 active
- `active`：审核通过后的唯一有效区，FastGPT 只读这里（list/tree/content/read/detail/raw）

带后台管理界面（若依风格，纯前端 Mock 骨架 + Cookie 登录守卫）：
- `/login`：登录页（Mock 账号 `admin@aizhujiao/admin123`），成功后写 `kb_admin_session` Cookie 并跳 `/admin`
- `/admin`：数据看板（四指标 Mock 卡片）；`/admin/staging`：暂存管理（Mock Table + 确认入库）；
  `/admin/api`：API 文档；三者由 layout.tsx（Sidebar + Header）统一包裹
- 全局守卫在 `src/proxy.ts`：访问 `/admin/*` 若无 `kb_admin_session` Cookie 则 307 重定向到 `/login`
- 根路径 `/` 与旧 `/stage` 均重定向：`/` → `/login`，`/stage` → `/admin/staging`

后端只读/写入 API 仍保留（FastGPT 对接、上传、审核），独立于后台 UI。

### 版本技术栈

- **Framework**: Next.js 16 (App Router)，自定义 server 入口 `src/server.ts`（生产经 tsup 打包为 `dist/server.js`）
- **Core**: React 19
- **Language**: TypeScript 5（strict）
- **UI 组件**: shadcn/ui（位于 `src/components/ui/`）
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── knowledge-base/           # 默认知识库目录（示例文件；生产用 KNOWLEDGE_BASE_ROOT 覆盖）
├── scripts/                  # 构建与启动脚本（prepare/build/dev/start，勿改）
├── src/
│   ├── app/
│   │   ├── page.tsx             # 首页：服务状态页 + 文件管理后台（上传/新建/删除/刷新缓存）
│   │   ├── layout.tsx           # metadata（robots noindex）
│   │   ├── v1/
│   │   │   ├── [...slug]/route.ts      # /v1 未匹配路径 JSON 404 兜底
│   │   │   ├── file/
│   │   │   │   ├── list/route.ts       # POST 文件树（FastGPT 官方规范）
│   │   │   │   ├── tree/route.ts       # GET  文件树（list 的 GET 别名）
│   │   │   │   ├── content/route.ts    # GET  文件内容（content 或 previewUrl）
│   │   │   │   ├── read/route.ts       # GET  文件阅读链接
│   │   │   │   └── detail/route.ts     # GET  文件详情
│   │   │   └── raw/[...slug]/route.ts  # GET/HEAD 原始文件下载/预览（默认免鉴权）
│   │   ├── api/
│   │   │   ├── open/
│   │   │   │   ├── upload/route.ts          # POST FormData 上传到 staging（等待审核）
│   │   │   │   └── v1/file/{list,content,read,detail}/route.ts  # 现行 FastGPT 对接前缀
│   │   │   └── admin/
│   │   │       ├── confirm/route.ts       # POST 审核入库：syncToVolcanoAPI mock + rename 到 active
│   │   │       ├── upload/route.ts        # POST FormData 上传（同名默认重命名，overwrite=true 覆盖）
│   │   │       ├── file/route.ts          # DELETE 删除文件/空文件夹
│   │   │       ├── folder/route.ts        # POST 创建文件夹（支持多级）
│   │   │       ├── flush-cache/route.ts   # POST 主动刷新索引缓存
│   │   │       └── stage/
│   │   │           ├── list/route.ts      # GET 暂存区文件列表 + 暂存/索引计数
│   │   │           ├── upload/route.ts    # POST 上传到暂存区（不入索引）
│   │   │           ├── commit/route.ts    # POST 确认入库（暂存→索引，复制+刷新索引）
│   │   │           └── file/route.ts      # DELETE 删除暂存文件
│   │   ├── stage/page.tsx            # 第二页面：索引与暂存（数量对账 + 确认入库）
│   │   ├── components/kb-admin.tsx  # 文件管理台客户端组件（token 输入、文件树、上传/新建/删除/预览）
│   │   ├── components/stage-admin.tsx  # 索引与暂存客户端组件（对账、确认入库、删除、刷新）
│   │   └── components/ui/          # shadcn/ui
│   ├── lib/
│   │   ├── config.ts         # 环境变量配置（唯一读取入口）+ tokenEqual
│   │   ├── auth.ts           # Bearer Token 校验（Edge/Node 通用，proxy 使用）
│   │   ├── file-utils.ts     # 底层 fs/promises 工具：读目录/移动/上传落盘/路径防逃逸
│   │   ├── file-repo.ts      # 文件仓库适配层：扫描、内存索引、id 规范化、统计（扫 active）
│   │   ├── file-service.ts   # 文件树查询共享逻辑（tree/list 共用）
│   │   ├── file-types.ts     # 文本扩展名集合与 MIME 映射
│   │   ├── adminfs.ts        # admin 写操作安全层：路径防逃逸校验、上传/建目录/删除、日志
│   │   ├── stage-repo.ts     # 暂存区适配层：上传暂存、确认入库（commit）、列表、删除、统计
│   │   ├── admin-route.ts    # admin 路由包装：强制鉴权 + 统一 JSON 错误
│   │   ├── urls.ts           # 对外 baseURL 推断与 raw URL 构造
│   │   ├── errors.ts         # ApiError 与 JSON 错误信封
│   │   ├── api-route.ts      # 路由统一成功/异常包装
│   │   └── utils.ts          # cn
│   └── proxy.ts              # Next16 Proxy（旧称 middleware），Node runtime，统一鉴权/405
├── .env.example              # 环境变量样例（提交）
├── .env.local                # 本地开发 token（gitignore，勿提交真实密钥）
├── next.config.ts
└── DEPLOYMENT.md             # 部署、自定义域名、FastGPT 对接说明
```

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `FASTGPT_FILE_LIBRARY_TOKEN` | 是 | 无 | Bearer Token；未配置时受保护接口一律 401 |
| `KNOWLEDGE_BASE_ROOT` | 否 | `./knowledge-base` | 知识库根目录绝对路径（含 staging/active 子目录） |
| `STAGING_ROOT` | 否 | `<root>/staging` | 暂存区目录绝对路径（上传先进这里，确认后入 active） |
| `ACTIVE_ROOT` | 否 | `<root>/active` | 有效区目录绝对路径（审核通过后 FastGPT 只读这里） |
| `PUBLIC_BASE_URL` | 否 | 按请求头推断 | 拼接 previewUrl/read url 的绝对基地址 |
| `MAX_TEXT_BYTES` | 否 | `5242880` | 文本内联上限，超过则只给 previewUrl |
| `SCAN_CACHE_TTL_MS` | 否 | `10000` | 内存索引缓存时长 |
| `INCLUDE_HIDDEN` | 否 | `false` | 是否扫描点号开头文件 |
| `IGNORE_NAMES` | 否 | 空 | 额外忽略的文件/目录名，逗号分隔 |
| `REQUIRE_RAW_TOKEN` | 否 | `false` | raw 下载端点是否强制鉴权（支持 `?token=`） |

> 生产环境在阿里云部署面板、ECS 环境变量或配置中心注入，不要写进代码或 `.env.local`。

## 关键约定与排障指引

- **三区链路（上传→审核→有效）**：第三方 `POST /api/open/upload` 落 `staging`；
  `POST /api/admin/confirm` 先调 `syncToVolcanoAPI(filename)`（预留火山 mock，恒 true）
  再 `fs.rename` 到 `active`；FastGPT 所有读取（list/tree/content/read/detail/raw）只读 `active`。
  底层文件操作集中在 `lib/file-utils.ts`（fs/promises），不绕缓存。
- **id 即相对路径**：文件/文件夹 id = 相对 `ACTIVE_ROOT` 的 POSIX 路径；根为 `root`，
  顶层节点 `parentId` 为 `null`。`normalizeRelId` 拒绝绝对路径与 `..`，防目录逃逸。
- **索引模型**：懒扫描 + TTL 缓存（`getSnapshot`，扫描 `ACTIVE_ROOT`），同一时刻只允许一个扫描任务；
  扫描不跟随符号链接。改文件后最多等待一个 TTL 即生效；管理写接口（upload/folder/file）
  成功后会自动调用 `refreshIndex()` 立即刷新，消除延迟。
- **admin 写操作安全**：`/api/admin/*` 一律强制 Bearer 鉴权（proxy + runAdmin 双重校验）；
  路径经 `assertSafeRel`（拒绝 `..`/绝对路径/盘符/URL scheme/NUL/反斜杠）并可调
  `assertNoSymlinkAlong` 逐级防符号链接逃逸；上传同名默认自动重命名（overwrite=true 才覆盖），
  删除仅限单文件或空目录。
- **FastGPT 兼容性**：官方文件树接口是 `POST /v1/file/list`（源码
  `packages/service/core/dataset/apiDataset/custom/api.ts`），`GET /v1/file/tree`
  是按用户要求提供的同义别名；响应统一信封 `{ success, message, data }`。
- **previewUrl 免鉴权**：FastGPT 服务端直接 GET previewUrl 且不带 Authorization，
  因此 `/v1/raw/*` 默认公开；需要收紧设 `REQUIRE_RAW_TOKEN=true`。
- **Proxy 而非 middleware**：`src/proxy.ts` 是 Next 16 新约定，始终 Node runtime，
  能读到部署时注入的运行时环境变量（Edge middleware 的 env 构建期内联）。
  导出名必须是 `proxy` 或 default。
- **所有错误必须是 JSON**：路由异常走 `runApi`/`jsonErrorResponse`；
  `/v1` 未匹配由 catch-all 返回 JSON 404；proxy 返回 401/405 JSON。
- **生产模式判定**：`src/server.ts` 使用 `APP_ENV !== 'PROD' && NODE_ENV !== 'production'` 决定 dev；
  本地手动跑 `dist/server.js` 时必须带 `APP_ENV=PROD` 或 `NODE_ENV=production`。

## 构建与测试命令（仅 pnpm）

- 静态检查：`pnpm ts-check`、`pnpm lint --quiet`（交付前由 test_run 自动执行）
- 开发：`bash ./scripts/dev.sh`（端口取 `APP_RUN_PORT`）
- 生产构建：`bash ./scripts/build.sh`（next build + tsup 打包 `src/server.ts`）
- 生产启动：`bash ./scripts/start.sh`（运行 `dist/server.js`）

