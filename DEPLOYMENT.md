# 部署与 FastGPT 对接说明

本服务为 FastGPT「API 文件库」提供文件树、文件内容、阅读链接和文件详情接口。
所有接口响应均为 `application/json`，错误也不返回 HTML。

---

## 一、接口清单

| 方法 | 路径 | 说明 | 鉴权 |
| --- | --- | --- | --- |
| POST | `/v1/file/list` | 获取文件树（**FastGPT 官方规范**，body：`parentId?`、`searchKey?`） | Bearer |
| GET | `/v1/file/tree` | 文件树的 GET 别名（Query：`parentId?`、`searchKey?`），行为与 list 完全一致 | Bearer |
| GET | `/v1/file/content?id=` | 文本返回 `content`；PDF/Word 等返回 `previewUrl` | Bearer |
| GET | `/v1/file/read?id=` | 返回文件阅读链接 `{ data: { url } }` | Bearer |
| GET | `/v1/file/detail?id=` | 文件/文件夹详情 | Bearer |
| GET/HEAD | `/v1/raw/<相对路径>` | 原始文件下载 / 内联预览（即 previewUrl 指向的地址），默认免鉴权 | 默认公开 |

> FastGPT 对接时的官方标准端点也提供了 **`/api/open` 前缀版本**（推荐使用，路径与上面一一对应）：
>
> | 方法 | 路径 | 说明 |
> | --- | --- | --- |
> | POST | `/api/open/v1/file/list` | 文件树（body：`parentId?`、`searchKey?`） |
> | GET | `/api/open/v1/file/content?id=` | 文本返回 `content`；二进制返回 `previewUrl` |
> | GET | `/api/open/v1/file/read?id=` | 阅读链接 `{ data: { url } }` |
> | GET | `/api/open/v1/file/detail?id=` | 文件/文件夹详情 |
>
> 两者共用同一份底层实现与同一套鉴权 token，可同时访问。推荐在 FastGPT
> 的 baseURL 中使用 `/api/open` 前缀以清晰区分 API 命名空间。

统一响应信封：

```json
{ "success": true, "message": "", "data": ... }
```

错误：`400` 参数错误 / `401` 鉴权失败 / `404` 文件不存在 / `405` 方法不允许 /
`500` 内部错误 / `503` 知识库根目录不可用，错误体均为
`{ "success": false, "message": "...", "error": { "code": "..." } }`。

### id 规则

- 文件 / 文件夹的 id 就是它相对于知识库根目录的 POSIX 路径，例如
  `welcome.md`、`guides/fastgpt.md`；id 跨重启稳定，重命名/移动会改变 id。
- 根目录 id 为 `root`；顶层节点 `parentId` 为 `null`。
- 服务不跟随软链接，并拒绝任何包含 `..` 的路径（防目录逃逸）。

### 文本与二进制的处理

- 纯文本（txt/md/json/csv/代码等，且体积 ≤ `MAX_TEXT_BYTES`，默认 5 MiB）：
  `/v1/file/content` 直接返回 `content`，同时附带 `previewUrl` 兜底。
- PDF / Word / Excel / PPT / 图片等：只返回 `previewUrl`，FastGPT 自行下载解析。

---

## 二、环境变量（阿里云部署面板 / ECS 环境变量）

生产环境建议通过阿里云 ECS 启动脚本、容器环境变量或配置中心注入，不要提交到仓库。

| 变量 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| `FASTGPT_FILE_LIBRARY_TOKEN` | 是 | `随机长字符串` | FastGPT 请求 Bearer Token，建议 32 位以上随机字符串 |
| `APP_ENV` | 生产必填 | `PROD` | 生产环境必须为 `PROD`，否则可能以开发模式启动 |
| `PORT` | 可选 | `5000` | Node 服务监听端口 |
| `HOST` | 可选 | `0.0.0.0` | 监听地址，阿里云 ECS / 容器通常使用 `0.0.0.0` |
| `PUBLIC_BASE_URL` | 推荐 | `https://kb.example.com` | 对外 HTTPS 域名，用于 previewUrl、readUrl 和火山回源 |
| `KNOWLEDGE_BASE_ROOT` | 推荐 | `/data/knowledge-base` | 知识库根目录绝对路径；不填则使用项目内 `./knowledge-base` |
| `LOCAL_DATA_ROOT` | 可选 | `<KNOWLEDGE_BASE_ROOT>/local-data` | 用户信息、聊天记录等暂存/正式库中间文件目录 |
| `MAX_TEXT_BYTES` | 可选 | `5242880` | 文本内联上限 |
| `SCAN_CACHE_TTL_MS` | 可选 | `10000` | 索引缓存时长 |
| `IGNORE_NAMES` | 可选 | `.obsidian,tmp` | 额外忽略的文件/目录名 |
| `INCLUDE_HIDDEN` | 可选 | `false` | 是否扫描点号开头文件 |
| `REQUIRE_RAW_TOKEN` | 可选 | `false` | 为 true 时 raw 端点也需鉴权 |
| `ALZHUJIAO_SUPABASE_URL` | 用户数据必填 | `https://xxxx.supabase.co` | 用户信息、校准、聊天记录使用的 Alzhujiao 实例 |
| `ALZHUJIAO_SUPABASE_KEY` | 用户数据必填 | `sb_secret_xxx` | Alzhujiao 服务端密钥，禁止下发浏览器 |
| `VOLCES_SUPABASE_URL` | 知识库持久化必填 | `https://xxxx.supabase2.aidap-global.cn-beijing.volces.com` | 底层知识库文件持久化实例 |
| `VOLCES_SUPABASE_KEY` | 知识库持久化必填 | `sb_secret_xxx` | 火山实例服务端密钥 |
| `SUPABASE_TABLE_PREFIX` | 推荐 | `ai_teacher_` | 本项目专属表前缀，隔离其他项目数据 |
| `ADMIN_TOKEN` | 推荐 | `随机长字符串` | 后台管理接口独立口令 |
| `ADMIN_ACCOUNT` / `ADMIN_PASSWORD` | 可选 | `admin@example.com` / 强密码 | 后台登录账号密码 |
| `GULESI_BASE_URL` | 可选 | `https://api.gulesi.com` | 谷乐斯小程序用户数据 API 基础地址 |
| `GULESI_API_KEY` | 用户信息读取必填 | `hly_live_xxx` | 谷乐斯全字段 API Key，仅服务端使用 |
| `AGENT_CHAT_API_URL` | 聊天记录读取必填 | `https://example.com/api/chat-records` | 智能体聊天记录 API 地址 |
| `AGENT_CHAT_API_KEY` | 聊天记录读取必填 | `随机密钥` | 智能体聊天记录 API 密钥 |
| `AGENT_CHAT_API_KEY_HEADER` | 可选 | `Authorization` | 密钥请求头；Authorization 会自动补 Bearer |
| `AGENT_USER_API_URL` | 智能体用户读取必填 | `https://example.com/api/users` | 智能体用户信息 API 地址 |
| `AGENT_USER_API_KEY` | 智能体用户读取必填 | `随机密钥` | 智能体用户 API 密钥 |
| `AGENT_USER_API_KEY_HEADER` | 可选 | `Authorization` | 智能体用户 API 密钥请求头 |

### 知识库文件怎么放到线上

两种方式任选：

1. **随仓库发布**：直接把文件提交到项目的 `knowledge-base/` 目录，保持
   `KNOWLEDGE_BASE_ROOT` 为默认值即可。
2. **挂载外部目录**：将阿里云云盘、NAS 或宿主机目录挂载到绝对路径（如
   `/data/knowledge-base`），再把 `KNOWLEDGE_BASE_ROOT` 设为该路径。

### 外部数据源说明

- **用户信息管理**：数据源下拉框包含「谷乐斯小程序用户数据（全字段）」和「智能体用户数据」。
  小程序使用 `GULESI_API_KEY` 通过 `X-API-Key` 读取，智能体使用 `AGENT_USER_API_URL` /
  `AGENT_USER_API_KEY`。浏览器不会接触密钥。
- **正式库流向**：确认后进入正式库文件区；上传时小程序写入 `user_info_mini`，智能体写入
  `user_info_agent`。点击「校准」后以智能体用户为基础，按手机号匹配小程序用户并写入 `user_info`。
  匹配成功标记 `calibration_status=success`，未匹配标记 `failed`。
- **用户聊天记录**：数据源下拉框当前只有「智能体聊天记录 API」。接口地址与密钥待提供后，
  在部署环境配置 `AGENT_CHAT_API_URL` / `AGENT_CHAT_API_KEY` 即可启用。
- **Supabase 网络**：阿里云中国大陆节点访问 Supabase 可能被重置或超时。生产上线前请从目标
  ECS/容器实测；如不可达，可改用国内可访问的 Supabase 兼容 REST 地址、Supabase 自定义域名、海外/香港节点或自建兼容 PostgreSQL API。
- **谷乐斯证书**：当前 `api.gulesi.com` 的 HTTPS 证书校验异常。生产环境不能设置
  `NODE_TLS_REJECT_UNAUTHORIZED=0`，应由谷乐斯续期证书或提供有效证书域名后再上线。

---

## 三、部署步骤（阿里云 ECS / Docker / Node.js）

### 方式 A：ECS 直接运行

1. 安装 Node.js 20+ 与 pnpm 9+。
2. 拉取代码并安装依赖：`pnpm install --frozen-lockfile`。
3. 配置环境变量，至少设置 `APP_ENV=PROD`、`FASTGPT_FILE_LIBRARY_TOKEN` 和
   `PUBLIC_BASE_URL`。
4. 构建：`pnpm build`。
5. 启动：`pnpm start`，或使用 `bash ./scripts/start.sh`。
6. 用 systemd / supervisor / pm2 托管 `node dist/server.js`，并通过 Nginx 或阿里云
   SLB 反向代理到 `127.0.0.1:5000`。

### 方式 B：Docker / ACK

1. 构建镜像后在环境变量中注入 `APP_ENV=PROD`、`PORT=5000`、`PUBLIC_BASE_URL` 和业务密钥。
2. 将知识库目录挂载到容器内的 `/data/knowledge-base`。
3. 通过阿里云 SLB / Ingress 暴露 5000 端口，并配置 HTTPS 证书。

### 部署后验证

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://你的域名/v1/file/list -X POST
# 期望 401

curl -s -X POST https://你的域名/v1/file/list \
  -H 'Authorization: Bearer 你的TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"parentId":null}'
# 期望 {"success":true,...}
```

---

## 四、绑定阿里云域名与 HTTPS

1. 在阿里云域名控制台为域名添加 A 记录指向 ECS 公网 IP，或添加 CNAME 指向 SLB / CDN 域名。
2. 在阿里云 SSL 证书服务申请或上传证书，并在 Nginx、SLB 或 Ingress 上启用 HTTPS。
3. 把 Nginx / SLB 的 `X-Forwarded-Proto` 和 `X-Forwarded-Host` 传给应用。
4. 在环境变量中设置 `PUBLIC_BASE_URL=https://你的域名`。
5. FastGPT 和火山知识库都会通过该 HTTPS 地址拉取文件，请确保域名公网可达。

---

## 五、FastGPT 对接说明

在 FastGPT 创建知识库时选择「**API 文件库**」，填写三个参数：

1. **baseURL**

   ```text
   https://你的域名/api/open
   ```

   - 请带 **`/api/open`** 后缀（服务端同时保留无此前缀的 `/v1` 版本，两者等效）。
     路径将由 FastGPT 自行拼接，例如 `https://你的域名/api/open/v1/file/list`。
   - 以 `/api/open` 结尾，**不要带 `/v1`、不要以斜杠结尾**。
   - 本地联调时可临时填 `http://localhost:5000/api/open`（FastGPT 服务端需能访问到该地址）。

2. **authorization**

   ```text
   your-fastgpt-token   （以环境变量 FASTGPT_FILE_LIBRARY_TOKEN 的值为准）
   ```

   - **只填 token 原文，不要带 `Bearer ` 前缀**——FastGPT 源码会自动拼成
     `Authorization: Bearer <authorization>`。

3. **basePath**（可选）

   - **留空**：从知识库根目录开始浏览，绝大多数场景留空即可。
   - 也可以填某个文件夹的 **id**（即该文件夹相对根目录的路径），例如 `docs/team-a`，
     FastGPT 首次拉取时会把它作为 `parentId`，文件树从该目录开始。

创建后 FastGPT 会立即调用 `POST /v1/file/list` 加载根目录。若列表加载失败：

- 401：authorization 与服务端 token 不一致，或误带了 `Bearer ` 前缀。
- 404/树为空：检查 `KNOWLEDGE_BASE_ROOT` 路径和文件权限；首页会显示实际扫描的根目录。
- previewUrl 拉取失败：确认域名已启用 HTTPS（免费证书即可）；
  raw 端点默认免鉴权，一般不需要额外配置。

### 4 个接口调用示例（供自测 / 对接参考）

```bash
# 文件树（POST，parentId 必填，null 表示根目录；searchKey 可选）
curl -X POST 'https://你的域名/api/open/v1/file/list' \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"parentId": null, "searchKey": ""}'

# 文件内容（文本返回 content，二进制返回 previewUrl；id 为相对路径）
curl 'https://你的域名/api/open/v1/file/content?id=0619%EF%BC%8D%E7%9F%A5%E8%AF%86%E5%BA%931%EF%BC%9A%E8%82%A0%E9%81%93%E8%8F%8C%E7%BE%A4%E7%9F%A5%E8%AF%86.docx' \
  -H 'Authorization: Bearer <token>'

# 阅读链接（拿到后可直接打开原文）
curl 'https://你的域名/api/open/v1/file/read?id=<相对路径>' \
  -H 'Authorization: Bearer <token>'

# 文件详情
curl 'https://你的域名/api/open/v1/file/detail?id=<相对路径>' \
  -H 'Authorization: Bearer <token>'
```

> `id` 就是文件相对于知识库根目录的路径（中文会做 URL 编码，空格等特殊字符亦可），
> 可通过上面的 `list` 接口拿到。当前知识库根目录下为 12 个示例知识库文件。

### 安全说明（重要）

FastGPT 下载 `previewUrl` 时是服务端直接 GET、**不携带 Authorization 头**，因此
`/v1/raw/*` 默认公开可访问（知道完整文件路径即可下载）。元数据接口
（tree/list/content/read/detail）始终强制 Bearer 鉴权。

- 如知识库文件本身敏感，可设置 `REQUIRE_RAW_TOKEN=true`：此时 raw 端点接受
  `?token=<FASTGPT_FILE_LIBRARY_TOKEN>` 或 Authorization 头。
  **注意**：这会让未改造的 FastGPT 无法直接拉取 previewUrl（标准 FastGPT 不会在下载时
  附 token），开启前请先确认你的 FastGPT 版本/调用链支持。
- 建议：不要把真正的私密文件放进该知识库；token 只通过部署环境变量注入，不写入代码。

---

## 六、本地开发

```bash
pnpm install
cp .env.example .env.local   # 在 .env.local 里设置 FASTGPT_FILE_LIBRARY_TOKEN
pnpm run dev                 # http://localhost:5000
```

把测试文件放入 `knowledge-base/`，浏览器打开 `http://localhost:5000` 查看状态页。
`.env.local` 已加入 `.gitignore`，请勿提交真实密钥。

