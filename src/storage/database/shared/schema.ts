import { pgTable, serial, timestamp, text, integer, index, varchar } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { tableName } from '@/storage/database/table-names'



export const healthCheck = pgTable(tableName('health_check'), {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

/**
 * 知识库文件持久化表。
 * 用于把 active（正式库）中的文件内容持久化到数据库中，避免生产环境 /tmp 目录
 * 在重新部署/实例重启后被清空导致文件丢失。文件以二进制（bytea）存储，
 * 配套 name（文件名）与 zone（所在区）等元数据，支持按 name+zone 唯一去重（覆盖写入）。
 */
export const kbFiles = pgTable(
  tableName('kb_files'),
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    zone: text("zone").notNull().default("active"),
    content_type: text("content_type"),
    size: integer("size").notNull().default(0),
    // 文件格式（docx/pdf/xlsx 等，展示用）
    format: text("format"),
    // 同步状态（local=本地 / modified=修改 / synced=已入库）
    status: text("status").notNull().default("local"),
    // 文件二进制内容（base64 编码文本）
    content: text("content").notNull(),
    synced_at: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index(tableName('kb_files_name_zone_idx')).on(table.name, table.zone),
  ]
);

/**
 * 用户知识库文件表（与底层知识库完全独立）。
 * 面向「用户信息管理」页面，存放用户上传的文件内容（base64 文本），
 * 结构独立、数据独立，不参与 FastGPT 底层拉取与火山同步。
 */
export const userKbFiles = pgTable(
  tableName('user_kb_files'),
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    content_type: text("content_type"),
    size: integer("size").notNull().default(0),
    format: text("format"),
    // 文件二进制内容（base64 编码文本）
    content: text("content").notNull(),
    // 处理状态：staging=暂存 / parsed=已解析(待入库) / committed=已入库
    status: text("status").notNull().default("staging"),
    // 解析结果（DS 模型解析内容后，对照表格模板生成的用户信息数据，JSON 文本）
    parsed_result: text("parsed_result"),
    parsed_at: timestamp("parsed_at", { withTimezone: true }),
    committed_at: timestamp("committed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index(tableName('user_kb_files_name_idx')).on(table.name),
  ]
);

