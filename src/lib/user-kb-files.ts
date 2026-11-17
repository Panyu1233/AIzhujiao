/**
 * 用户信息文件访问层。
 *
 * 文件先写入项目本地持久化目录（默认 knowledge-base/local-data/user-info），
 * 暂存、正式库都只落本地；只有用户在正式库点击“上传数据库”时才写入 Supabase。
 */
import {
  localDeleteRecord,
  localGetRecord,
  localListRecords,
  localNewRecordId,
  localPutRecord,
  type LocalJsonRecord,
} from './local-json-store';

export type UserDataSource = 'gulesi_mini_program' | 'agent_api' | 'unidentified_agent_user';

export const USER_DATA_SOURCE_LABELS: Record<UserDataSource, string> = {
  gulesi_mini_program: '谷乐斯小程序用户',
  agent_api: '智能体用户',
  unidentified_agent_user: '未标识的智能体用户',
};

export interface UserKbFileRow {
  id: string;
  name: string;
  content_type?: string | null;
  size: number;
  format?: string | null;
  data_source?: UserDataSource | string | null;
  /** 处理状态：staging=暂存 / parsed=正式库待上传 / committed=已上传数据库 */
  status?: string | null;
  /** 解析结果（DS 模型生成，对照表格模板的用户信息数据，JSON 文本） */
  parsed_result?: string | null;
  record_count?: number;
  source_type?: string | null;
  ds_provider?: string | null;
  parsed_at?: string | null;
  committed_at?: string | null;
  /** 原始导入文件可保留在本地，但从管理列表隐藏。 */
  hidden?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface UserKbFileDetail extends UserKbFileRow {
  content?: Buffer;
}

interface StoredUserKbFile extends LocalJsonRecord {
  content_type?: string | null;
  size: number;
  format?: string | null;
  data_source?: UserDataSource | string | null;
  status: string;
  content_base64: string;
  source_payload?: string | null;
  parsed_result?: string | null;
  parsed_text?: string | null;
  parsed_at?: string | null;
  record_count?: number;
  source_type?: string | null;
  ds_provider?: string | null;
  committed_at?: string | null;
  hidden?: boolean;
}

const STORE = 'user-info';

/** 用户信息三态标签。 */
export const USER_KB_STATUS = {
  staging: { label: '暂存', color: 'bg-blue-100 text-blue-800' },
  parsed: { label: '正式库待上传', color: 'bg-amber-100 text-amber-800' },
  committed: { label: '已上传数据库', color: 'bg-emerald-100 text-emerald-800' },
} as const;
export type UserKbStatus = keyof typeof USER_KB_STATUS;

function toDetail(record: StoredUserKbFile): UserKbFileDetail {
  const { content_base64, parsed_text: _text, source_payload: _payload, ...row } = record;
  return { ...row, content: Buffer.from(content_base64, 'base64') };
}

function toRow(record: StoredUserKbFile): UserKbFileRow {
  const { content: _content, parsed_result: _parsedResult, ...row } = toDetail(record);
  return row;
}

/** 列表（不含二进制内容，仅元数据）。默认过滤 hidden，仅维护脚本可显式包含。 */
export async function userKbListFiles(
  options: { includeHidden?: boolean } = {},
): Promise<UserKbFileRow[]> {
  const records = await localListRecords<StoredUserKbFile>(STORE);
  return records
    .filter((record) => options.includeHidden === true || record.hidden !== true)
    .map(toRow);
}

/** 读取单个用户信息文件（含内容）。 */
export async function userKbGetFile(name: string): Promise<UserKbFileDetail | null> {
  const record = await localGetRecord<StoredUserKbFile>(STORE, name);
  if (!record) return null;
  return toDetail(record);
}

/** 按文件名读取内容，name 不存在返回 null。 */
export async function userKbGetContent(name: string): Promise<Buffer | null> {
  const detail = await userKbGetFile(name);
  return detail?.content ?? null;
}

/** 写入（覆盖）一个用户信息文件。存在同名则覆盖内容并更新时间。 */
export async function userKbPutFile(
  name: string,
  content: Buffer,
  opts: {
    contentType?: string | null;
    format?: string | null;
    dataSource?: UserDataSource;
    sourcePayload?: unknown;
  } = {},
): Promise<void> {
  const existing = await localGetRecord<StoredUserKbFile>(STORE, name);
  const now = new Date().toISOString();
  await localPutRecord<StoredUserKbFile>(STORE, {
    ...(existing ?? {}),
    id: existing?.id ?? localNewRecordId(name),
    name,
    content_type: opts.contentType ?? existing?.content_type ?? null,
    size: content.length,
    format: opts.format ?? inferFormat(name),
    data_source: opts.dataSource ?? existing?.data_source ?? 'gulesi_mini_program',
    // 同名文件只要重新上传/重新拉取，就必须重新走“确认 -> 上传数据库”流程。
    status: 'staging',
    content_base64: content.toString('base64'),
    source_payload:
      opts.sourcePayload === undefined ? existing?.source_payload ?? null : JSON.stringify(opts.sourcePayload),
    parsed_result: null,
    parsed_text: null,
    parsed_at: null,
    committed_at: null,
    hidden: false,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  });
}

/** 保存一个已经由 DS 解析完成的独立 DOCX，状态直接进入正式库待上传。 */
export async function userKbPutParsed(
  name: string,
  content: Buffer,
  opts: {
    contentType?: string | null;
    format?: string | null;
    dataSource: UserDataSource;
    parsedResult: unknown;
    recordCount: number;
    dsProvider: string;
    sourceType?: string | null;
  },
): Promise<void> {
  const existing = await localGetRecord<StoredUserKbFile>(STORE, name);
  const now = new Date().toISOString();
  await localPutRecord<StoredUserKbFile>(STORE, {
    ...(existing ?? {}),
    id: existing?.id ?? localNewRecordId(name),
    name,
    content_type: opts.contentType ?? existing?.content_type ?? null,
    size: content.length,
    format: opts.format ?? inferFormat(name),
    data_source: opts.dataSource,
    status: 'parsed',
    content_base64: content.toString('base64'),
    source_payload: null,
    parsed_result: JSON.stringify(opts.parsedResult),
    parsed_text: null,
    parsed_at: now,
    record_count: opts.recordCount,
    source_type: opts.sourceType ?? 'agent_sqlite',
    ds_provider: opts.dsProvider,
    committed_at: null,
    hidden: false,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  });
}

/** 保留原始文件及解析结果，仅控制是否显示在管理列表中。 */
export async function userKbSetHidden(name: string, hidden: boolean): Promise<void> {
  const existing = await localGetRecord<StoredUserKbFile>(STORE, name);
  if (!existing) throw new Error('用户信息文件不存在');
  await localPutRecord<StoredUserKbFile>(STORE, {
    ...existing,
    hidden,
    updated_at: new Date().toISOString(),
  });
}

/**
 * 用解析生成的正式库文件内容替换原记录，并置为 parsed（正式库待上传）。
 * 当前用户信息正式库固定保持 DOCX 格式。
 */
export async function userKbReplaceContent(
  oldName: string,
  newName: string,
  content: Buffer,
  opts: { contentType?: string | null; format?: string | null } = {},
  extra: { parsedResult?: string | null; text?: string | null } = {},
): Promise<void> {
  const existing = await localGetRecord<StoredUserKbFile>(STORE, oldName);
  if (!existing) throw new Error('文件不存在或内容为空');
  const now = new Date().toISOString();
  await localPutRecord<StoredUserKbFile>(STORE, {
    ...existing,
    id: localNewRecordId(newName),
    name: newName,
    content_type: opts.contentType ?? null,
    format: opts.format ?? inferFormat(newName),
    size: content.length,
    status: 'parsed',
    content_base64: content.toString('base64'),
    parsed_result: extra.parsedResult ?? null,
    parsed_text: extra.text ?? existing.parsed_text ?? null,
    parsed_at: now,
    updated_at: now,
  });
  if (oldName !== newName) await localDeleteRecord(STORE, oldName);
}

/** 重命名本地用户信息文件，并完整保留内容、解析结果和状态。 */
export async function userKbRenameFile(oldName: string, newName: string): Promise<void> {
  if (oldName === newName) return;
  const existing = await localGetRecord<StoredUserKbFile>(STORE, oldName);
  if (!existing) throw new Error('用户信息文件不存在');
  const target = await localGetRecord<StoredUserKbFile>(STORE, newName);
  if (target) throw new Error('目标文件名已存在');
  const now = new Date().toISOString();
  await localPutRecord<StoredUserKbFile>(STORE, {
    ...existing,
    id: localNewRecordId(newName),
    name: newName,
    updated_at: now,
  });
  await localDeleteRecord(STORE, oldName);
}

/** 删除本地用户信息文件。返回是否真正删除了记录。 */
export async function userKbDeleteFile(name: string): Promise<boolean> {
  return localDeleteRecord(STORE, name);
}

/** 用户信息统计：文件总数与总体积。 */
export async function userKbStats(): Promise<{ count: number; totalBytes: number }> {
  const list = await userKbListFiles();
  return {
    count: list.length,
    totalBytes: list.reduce((sum, file) => sum + (file.size || 0), 0),
  };
}

/** 更新本地用户信息文件的处理状态。 */
export async function userKbUpdateStatus(
  name: string,
  status: UserKbStatus,
  extra: {
    parsedResult?: string | null;
    parsedText?: string | null;
    parsed_at?: boolean;
    committed_at?: boolean;
    recordCount?: number;
    dsProvider?: string | null;
  } = {},
): Promise<void> {
  const existing = await localGetRecord<StoredUserKbFile>(STORE, name);
  if (!existing) throw new Error('用户信息文件不存在');
  const now = new Date().toISOString();
  const updated: StoredUserKbFile = {
    ...existing,
    status,
    updated_at: now,
  };
  if (extra.parsedResult !== undefined) {
    updated.parsed_result = extra.parsedResult;
    updated.parsed_at = now;
  }
  if (extra.parsedText !== undefined) updated.parsed_text = extra.parsedText;
  if (extra.parsed_at) updated.parsed_at = now;
  if (extra.committed_at) updated.committed_at = now;
  if (extra.recordCount !== undefined) updated.record_count = extra.recordCount;
  if (extra.dsProvider !== undefined) updated.ds_provider = extra.dsProvider;
  await localPutRecord(STORE, updated);
}

/** 读取外部 API 生成 DOCX 时保留的原始单用户数据。 */
export async function userKbGetSourcePayload(name: string): Promise<unknown | null> {
  const record = await localGetRecord<StoredUserKbFile>(STORE, name);
  if (!record?.source_payload) return null;
  try {
    return JSON.parse(record.source_payload);
  } catch {
    return null;
  }
}

/** 读取单个文件的解析结果（JSON 对象，若已解析）。 */
export async function userKbGetParsed(name: string): Promise<unknown | null> {
  const detail = await userKbGetFile(name);
  if (!detail || !detail.parsed_result) return null;
  try {
    return JSON.parse(detail.parsed_result);
  } catch {
    return detail.parsed_result;
  }
}

/** 根据文件名推断展示格式（docx/pdf/xlsx/txt/其他）。 */
export function inferFormat(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx < 0) return 'FILE';
  return name.slice(idx + 1).toUpperCase();
}
