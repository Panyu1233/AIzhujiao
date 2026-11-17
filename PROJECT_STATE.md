# 项目状态

> 更新时间：2026-11-17  
> 项目：AI 助教用户信息与聊天记录解析  
> 当前阶段：本地 DS 解析结果已完成按用户拆分、双语 DOCX 生成和在线预览；Supabase 写入暂缓。

## 1. 当前目标

1. 用户 SQLite `sys_conf_01.db` 按 `contact_id` 去重，一个联系人一个 DOCX。
2. 聊天 SQLite `extractor.db` 按发送者 `sender_id` 聚合，一个发送者一个 DOCX，汇总其全部会话消息。
3. DOCX 对齐《知识库四表xlsx.xlsx》：
   - 表1 `user_info`：22 个字段。
   - 表2 `chat_message`：16 个字段。
4. 标题、表头、字段标签和说明采用中英文并列，布局与现有小程序用户信息文档一致。
5. 只复用本地 `parsed_result`，不重新调用 DS；不写 Supabase。

## 2. 完成情况

### 2.1 用户信息

- 原始联系人行：3243。
- 按 `contact_id` 去重后联系人：1659。
- 已生成智能体用户 DOCX：1659 个。
- 每个 DOCX 对应一个唯一 `contact_id`，状态为 `parsed`（正式库待上传）。
- 原始 `sys_conf_01.db` 记录保留在本地并隐藏，不在正式列表展示。

### 2.2 用户聊天

- 原始聊天消息：190。
- 按非 `self` 的 `sender_id` 聚合后发送者：71。
- 已生成聚合聊天 DOCX：71 个。
- 聚合消息总数：163。
- 排除 `self` 消息：27。
- 每个聊天 DOCX 汇总该发送者在全部会话中的消息，按 `send_time`、`id` 升序排列。
- 状态为 `formal`（正式库待上传）；原始 `extractor.db` 记录保留在本地并隐藏。

### 2.3 文件命名

- 小程序用户：`用户名称_手机号.docx`，已有 10 个文件符合该规则。
- 智能体用户和聊天：有手机号时同样使用 `用户名称_手机号.docx`。
- 无手机号时使用 `用户名称_未识别手机号_来源ID短码_稳定哈希.docx`，保证同名用户不会互相覆盖。
- 现有 1659 个智能体用户 DOCX 和 71 个聊天 DOCX 已全部切换为新规则；用户文件名 1669 个唯一，聊天文件名 71 个唯一。
- 当前智能体源库没有可关联的手机号，因此这些文件使用“未识别手机号”回退，不伪造手机号。
- `scripts/rename-agent-docx.ts` 可重复执行；再次运行结果为用户 `0 renamed / 1659 unchanged`，聊天 `0 renamed / 71 unchanged`。

### 2.4 DOCX 模板

- 用户文档：
  - 表1 的 22 个字段、顺序、类型、必填、键/索引与附件一致。
  - 使用六列表格：字段、类型、必填、键/索引、说明、用户值。
  - 字段标签为“中文 / English”，说明中英文各一行。
  - 缺失值统一为 `—`；跨页重复表头，表格行禁止拆页。
- 聊天文档：
  - 表2 的 16 个字段、顺序、类型、必填、键/索引与附件一致。
  - 包含发送者汇总、字段定义、每条消息的完整字段表。
  - `sender_openid` 使用 `sender_id` 作为来源标识，不冒充已验证的微信 OpenID。
  - DS 推断内容单独放在“AI 补充解析（推断） / AI Analysis (Inferred)”。
  - 每个消息块尽量与表头保持同页。

### 2.5 本地访问

- 本地数据目录已加入 `.gitignore`：
  - `knowledge-base/local-data/user-info`
  - `knowledge-base/local-data/chat-records`
- 每个本地文件的 `content_base64` 保存 DOCX 二进制，`parsed_result` 保存来源和拆分元数据。
- 管理页预览入口：
  - `/admin/user-kb`
  - `/admin/chat-records`
- DOCX、JSON、文本文件可在页面内在线预览或下载。

## 3. 关键代码

| 文件 | 作用 |
| --- | --- |
| `src/lib/formal-docx-schema.ts` | 表1/表2 的正式字段、双语标签和说明 |
| `src/lib/user-docx.ts` | 用户/聊天 DOCX 生成和双语正式模板 |
| `src/lib/agent-docx-split.ts` | 读取已有 DS 结果，按联系人或发送者拆分 |
| `src/lib/agent-sqlite-import.ts` | SQLite 读取、DS 解析、导入后自动拆分 |
| `scripts/split-agent-docx.ts` | 离线重新生成全部拆分 DOCX |
| `scripts/rename-agent-docx.ts` | 按“用户名称_手机号”批量重命名已有文件 |
| `src/lib/docx-preview.ts` | DOCX/JSON/文本本地在线预览 |
| `src/app/admin/user-kb/page.tsx` | 用户信息导入、列表、预览、下载 |
| `src/app/admin/chat-records/page.tsx` | 聊天导入、列表、预览、下载 |

## 4. 验证结果

- 全量检查 1659 个用户 DOCX：22 个字段、双语字段标签和表头均存在，0 错误。
- 全量检查 71 个聊天 DOCX：16 个字段、双语字段标签和表头均存在，0 错误。
- 校验聊天聚合：71 个发送者、163 条非 `self` 消息、27 条排除消息，0 错误。
- 校验用户来源：3243 行归并为 1659 个唯一 `contact_id`。
- 所有 DOCX ZIP/OOXML 魔数有效。
- 用户样本 3 页、聊天样本 20 页已完成视觉检查，无横向溢出；表头重复和消息块分页正常。
- `tsc -p tsconfig.json --noEmit`：通过。
- 相关文件 ESLint `--quiet`：通过。
- `pnpm ts-check` / `pnpm lint --quiet` 目前被 `pnpm-workspace.yaml` 中 `allowBuilds` 占位值触发的 `ERR_PNPM_IGNORED_BUILDS` 拦截；直接调用项目内 `tsc`/`eslint` 验证通过。

## 5. 运行方式

仅重命名已有文件，不调用 DS：

```powershell
node_modules\.bin\tsx.cmd scripts/rename-agent-docx.ts
```

重新生成全部拆分 DOCX，不调用 DS：

```powershell
node_modules\.bin\tsx.cmd scripts/split-agent-docx.ts
```

需要重新导入 SQLite 时才使用：

```powershell
node_modules\.bin\tsx.cmd scripts/import-agent-sqlite.ts users D:/Desktop/sys_conf_01.db
node_modules\.bin\tsx.cmd scripts/import-agent-sqlite.ts chats D:/Desktop/extractor.db
```

重新导入会覆盖同名本地记录并重新消耗 DS 调用。

## 6. 后续事项

1. 确认 `user_info`、`chat_message` 的 Supabase 目标表和字段映射。
2. 确认智能体 `contact_id` / `sender_id` 与小程序 `phone` / `openid` 的关联规则。
3. 完成映射后再开放“上传数据库”，先做可回滚试写。

## 7. 注意事项

- 不要提交 `.env.local`、API Key、本地解析内容或聊天原文。
- 当前智能体聊天来源仍禁止直接写 Supabase。
- 不删除用途未确认的临时文件；`.tmp-agent-import-min.js` 保持原状。

