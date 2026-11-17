# HANDOFF

## 当前目标

按用户要求交付“智能体用户信息 + 用户聊天记录”的完整压缩包，包含原始记录和解析完成记录两个顶层目录。不重新调用 DS，不写 Supabase。

## 本次交付

- 压缩包：`knowledge-base/local-data/exports/智能体用户与聊天记录_20261117.zip`
- 解压目录：`knowledge-base/local-data/exports/智能体用户与聊天记录_20261117/`
- 压缩包大小：约 23.6 MB，共 1732 个条目。
- 结构：
  - `原始记录/sys_conf_01.db`：智能体用户原始 SQLite。
  - `原始记录/extractor.db`：聊天原始 SQLite。
  - `解析完成的记录/智能体用户信息/`：1659 个 DOCX。
  - `解析完成的记录/用户聊天记录/`：71 个 DOCX。

## 验证结果

- 1659 个智能体用户 DOCX，71 个聊天 DOCX，数量与本地解析记录一致。
- 全部 1730 个 DOCX 都能作为 ZIP/OOXML 打开，且存在 `word/document.xml`。
- 2 个原始 SQLite 文件的魔数校验通过。
- 文件名冲突：0。
- 导出错误：0。

## 现有数据状态

- 小程序用户 DOCX：10 个，文件名保持“用户名称_手机号.docx”。
- 智能体用户 DOCX：1659 个，管理列表中仍隐藏，原始数据未删除。
- 聊天 DOCX：71 个，管理列表中可见。
- 71 个聊天文件仍没有可关联手机号，文件名使用“未识别手机号 + 来源ID + 哈希”回退。
- 智能体用户和聊天解析结果保留在本地 JSON 包装记录中，DOCX 二进制位于 `content_base64`。

## 关键文件

- `src/lib/agent-docx-split.ts`：按 contact_id/sender_id 拆分生成 DOCX。
- `src/lib/agent-sqlite-import.ts`：SQLite 原始记录读取与 DS 结果导入。
- `src/lib/user-kb-files.ts`：用户文件访问层，支持 includeHidden。
- `src/lib/chat-record-files.ts`：聊天文件访问层。
- `scripts/export-mini-program-user-docx.ts`：小程序用户 DOCX 导出。
- `scripts/hide-unidentified-agent-users.ts`：隐藏无法关联手机号的智能体用户文件。

## 后续

1. 若需要把压缩包放到桌面或其他交付目录，复制现成 zip，不要重新解析。
2. 若用户只要手机号可识别的文件，需要先取得 contact_id/sender_id 与小程序手机号映射。
3. 不删除原始 SQLite、本地 JSON 包装记录或 DOCX；不要提交 `knowledge-base/local-data/`。

## 注意

- 不提交 `.env.local`、API Key、聊天原文或本地解析数据。
- 当前工作区仍有历史未提交改动和临时 QA 文件，不要回滚或擅自清理。
