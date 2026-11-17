import { createHash } from 'node:crypto';
import { getAlzhujiaoSupabaseClient as getSupabaseClient } from '@/lib/supabase-clients';
import { tableName } from '@/storage/database/table-names';
import {
  localDeleteRecord,
  localGetRecord,
  localListRecords,
  localNewRecordId,
  localPutRecord,
  type LocalJsonRecord,
} from './local-json-store';

export interface ChatRecordFileRow {
  id: string;
  name: string;
  content_type?: string | null;
  size: number;
  format?: string | null;
  status: 'staging' | 'formal' | 'committed' | string;
  source_type?: string | null;
  source_url?: string | null;
  record_count: number;
  parsed_at?: string | null;
  ds_provider?: string | null;
  confirmed_at?: string | null;
  committed_at?: string | null;
  /** 原始导入文件可保留在本地，但从管理列表隐藏。 */
  hidden?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ChatRecordFileDetail extends ChatRecordFileRow {
  content?: Buffer;
  parsed_result?: string | null;
}

interface StoredChatRecordFile extends LocalJsonRecord {
  content_type?: string | null;
  size: number;
  format?: string | null;
  status: 'staging' | 'formal' | 'committed' | string;
  source_type?: string | null;
  source_url?: string | null;
  record_count: number;
  parsed_at?: string | null;
  ds_provider?: string | null;
  parsed_result?: string | null;
  confirmed_at?: string | null;
  committed_at?: string | null;
  hidden?: boolean;
  content_base64: string;
}

export const CHAT_RECORD_FILE_STATUS = {
  staging: { label: '暂存', color: 'bg-blue-100 text-blue-800' },
  formal: { label: '正式库待上传', color: 'bg-amber-100 text-amber-800' },
  committed: { label: '已上传数据库', color: 'bg-emerald-100 text-emerald-800' },
} as const;

type JsonRow = Record<string, unknown>;

const STORE = 'chat-records';

function toDetail(record: StoredChatRecordFile): ChatRecordFileDetail {
  const { content_base64, ...row } = record;
  return { ...row, content: Buffer.from(content_base64, 'base64') };
}

function toRow(record: StoredChatRecordFile): ChatRecordFileRow {
  const { content: _content, parsed_result: _parsedResult, ...row } = toDetail(record);
  return row;
}


function isObject(value: unknown): value is JsonRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractChatRows(payload: unknown): JsonRow[] {
  if (Array.isArray(payload)) return payload.filter(isObject);
  if (!isObject(payload)) return [];

  for (const key of ['items', 'records', 'messages', 'list', 'rows']) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isObject);
  }

  const data = payload.data;
  if (Array.isArray(data)) return data.filter(isObject);
  if (isObject(data)) {
    for (const key of ['items', 'records', 'messages', 'list', 'rows']) {
      const value = data[key];
      if (Array.isArray(value)) return value.filter(isObject);
    }
    return [data];
  }

  return [payload];
}

function valueAt(row: JsonRow, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function textAt(row: JsonRow, keys: string[], fallback = ''): string {
  const value = valueAt(row, keys);
  return value === undefined ? fallback : String(value).trim();
}

function numericAt(row: JsonRow, keys: string[]): number | null {
  const value = valueAt(row, keys);
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolIntAt(row: JsonRow, keys: string[]): number {
  const value = valueAt(row, keys);
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  return 0;
}

function timestampAt(row: JsonRow): string {
  const raw = valueAt(row, ['send_time', 'sendTime', 'msg_time', 'msgTime', 'create_time', 'createTime', 'timestamp']);
  if (raw === undefined) return new Date().toISOString();
  if (typeof raw === 'number') {
    const millis = raw < 10_000_000_000 ? raw * 1000 : raw;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  const rawText = String(raw).trim();
  if (/^\d{10}$/.test(rawText)) {
    const date = new Date(Number(rawText) * 1000);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  const date = new Date(rawText);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function nestedPhone(row: JsonRow): string {
  const direct = textAt(row, ['phone_snapshot', 'phone', 'phoneNumber', 'mobile', 'mobilePhone']);
  if (direct) return direct;
  for (const key of ['user', 'customer', 'contact']) {
    const nested = row[key];
    if (isObject(nested)) {
      const phone = textAt(nested, ['phone', 'phoneNumber', 'mobile', 'mobilePhone']);
      if (phone) return phone;
    }
  }
  return '';
}

function normalizeDirection(value: string, isAiReply: number): string {
  const normalized = value.toLowerCase();
  if (isAiReply === 1) return 'ai';
  if (['out', 'outbound', 'reply', 'assistant'].includes(normalized)) return 'ai';
  if (['in', 'inbound', 'customer'].includes(normalized)) return 'user';
  return normalized || 'user';
}

export function normalizeChatMessage(row: JsonRow): Record<string, unknown> | null {
  const phone = nestedPhone(row);
  if (!phone) return null;

  const directionRaw = textAt(row, ['msg_direction', 'direction', 'msgDirection']);
  const aiReply = boolIntAt(row, ['is_ai_reply', 'isAiReply', 'ai_reply']);
  const knowledgeId = numericAt(row, ['related_knowledge_id', 'relatedKnowledgeId', 'knowledge_id']);
  const groupId = textAt(row, ['group_id', 'groupId', 'chat_id', 'chatId', 'session_id', 'sessionId'], 'unknown');

  const normalized: Record<string, unknown> = {
    group_id: groupId,
    group_name_snapshot: textAt(row, ['group_name_snapshot', 'groupName', 'group_name', 'chat_name']) || null,
    group_nickname_snapshot: textAt(row, ['group_nickname_snapshot', 'groupNickname']) || null,
    sender_openid: textAt(row, ['sender_openid', 'senderOpenid', 'openid', 'from_openid']) || null,
    sender_nickname_snapshot: textAt(row, ['sender_nickname_snapshot', 'senderName', 'nickname', 'nickName']) || null,
    phone_snapshot: phone,
    msg_type: textAt(row, ['msg_type', 'msgType', 'type'], 'text'),
    content: textAt(row, ['content', 'text', 'message', 'msg']) || null,
    raw_content: row,
    media_url: textAt(row, ['media_url', 'mediaUrl', 'file_url', 'url']) || null,
    send_time: timestampAt(row),
    msg_direction: normalizeDirection(directionRaw, aiReply),
    is_ai_reply: aiReply,
    related_knowledge_id: knowledgeId,
    hit_status: textAt(row, ['hit_status', 'hitStatus']) || null,
    is_sensitive: boolIntAt(row, ['is_sensitive', 'isSensitive', 'sensitive']),
    desensitized_content: textAt(row, ['desensitized_content', 'desensitizedContent']) || null,
    memory_candidate: boolIntAt(row, ['memory_candidate', 'memoryCandidate']),
    memory_summary: textAt(row, ['memory_summary', 'memorySummary']) || null,
    memory_category: textAt(row, ['memory_category', 'memoryCategory']) || null,
    is_deleted: 0,
  };

  const wechatMsgId = textAt(row, ['wechat_msg_id', 'wechatMsgId', 'msg_id', 'msgId', 'message_id', 'messageId']);
  if (wechatMsgId) normalized.wechat_msg_id = wechatMsgId;
  const sessionId = textAt(row, ['session_id', 'sessionId']);
  if (sessionId) normalized.session_id = sessionId;

  return normalized;
}

export async function chatRecordFileList(): Promise<ChatRecordFileRow[]> {
  const records = await localListRecords<StoredChatRecordFile>(STORE);
  return records.filter((record) => record.hidden !== true).map(toRow);
}

export async function chatRecordFileGet(name: string): Promise<ChatRecordFileDetail | null> {
  const record = await localGetRecord<StoredChatRecordFile>(STORE, name);
  if (!record) return null;
  return toDetail(record);
}

export async function chatRecordFilePut(
  name: string,
  content: Buffer,
  opts: { contentType?: string | null; sourceUrl?: string | null } = {},
): Promise<ChatRecordFileRow> {
  let payload: unknown;
  try {
    payload = JSON.parse(content.toString('utf8'));
  } catch {
    throw new Error('上传内容必须是合法 JSON');
  }
  const existing = await localGetRecord<StoredChatRecordFile>(STORE, name);
  const now = new Date().toISOString();
  const record: StoredChatRecordFile = {
    ...(existing ?? {}),
    id: existing?.id ?? localNewRecordId(name),
    name,
    content_type: opts.contentType || 'application/json',
    size: content.length,
    format: 'JSON',
    content_base64: content.toString('base64'),
    status: 'staging',
    source_type: 'external_api',
    source_url: opts.sourceUrl || null,
    record_count: extractChatRows(payload).length,
    parsed_result: null,
    parsed_at: null,
    ds_provider: null,
    confirmed_at: null,
    committed_at: null,
    hidden: false,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await localPutRecord(STORE, record);
  return toRow(record);
}

/** 保存已经通过 DS 解析的智能体 SQLite 原库；只写本地正式库，不写 Supabase。 */
export async function chatRecordFilePutImported(
  name: string,
  content: Buffer,
  opts: {
    contentType?: string | null;
    format?: string | null;
    recordCount: number;
    parsedResult: unknown;
    dsProvider: string;
    sourceType?: string;
    hidden?: boolean;
  },
): Promise<ChatRecordFileRow> {
  const existing = await localGetRecord<StoredChatRecordFile>(STORE, name);
  const now = new Date().toISOString();
  const record: StoredChatRecordFile = {
    ...(existing ?? {}),
    id: existing?.id ?? localNewRecordId(name),
    name,
    content_type: opts.contentType || 'application/vnd.sqlite3',
    size: content.length,
    format: opts.format || 'SQLITE',
    content_base64: content.toString('base64'),
    status: 'formal',
    source_type: opts.sourceType || 'agent_sqlite',
    source_url: null,
    record_count: opts.recordCount,
    parsed_result: JSON.stringify(opts.parsedResult),
    parsed_at: now,
    ds_provider: opts.dsProvider,
    confirmed_at: now,
    committed_at: null,
    hidden: opts.hidden ?? false,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await localPutRecord(STORE, record);
  return toRow(record);
}

/** 保留原始文件及其解析结果，仅控制是否显示在管理列表中。 */
export async function chatRecordFileSetHidden(name: string, hidden: boolean): Promise<void> {
  const existing = await localGetRecord<StoredChatRecordFile>(STORE, name);
  if (!existing) throw new Error('聊天记录文件不存在');
  await localPutRecord<StoredChatRecordFile>(STORE, {
    ...existing,
    hidden,
    updated_at: new Date().toISOString(),
  });
}

/** 读取 DS 解析结果。 */
export async function chatRecordFileGetParsed(name: string): Promise<unknown | null> {
  const detail = await chatRecordFileGet(name);
  if (!detail?.parsed_result) return null;
  try {
    return JSON.parse(detail.parsed_result);
  } catch {
    return detail.parsed_result;
  }
}

export async function chatRecordFileConfirm(name: string): Promise<ChatRecordFileRow> {
  const detail = await chatRecordFileGet(name);
  if (!detail?.content) throw new Error('聊天记录文件不存在或内容为空');
  let payload: unknown;
  try {
    payload = JSON.parse(detail.content.toString('utf8'));
  } catch {
    throw new Error('聊天记录文件不是合法 JSON');
  }
  const rows = extractChatRows(payload);
  const valid = rows.map(normalizeChatMessage).filter(Boolean).length;
  if (valid === 0) throw new Error('没有可确认的聊天记录：每行至少需要手机号');

  const existing = await localGetRecord<StoredChatRecordFile>(STORE, name);
  if (!existing) throw new Error('聊天记录文件不存在或内容为空');
  const now = new Date().toISOString();
  const updated: StoredChatRecordFile = {
    ...existing,
    status: 'formal',
    record_count: valid,
    confirmed_at: now,
    updated_at: now,
  };
  await localPutRecord(STORE, updated);
  return toRow(updated);
}

export async function chatRecordFileCommit(name: string): Promise<{ inserted: number; skipped: number }> {
  const detail = await chatRecordFileGet(name);
  if (!detail?.content) throw new Error('聊天记录文件不存在或内容为空');
  if (detail.status !== 'formal') {
    throw new Error('该文件尚未确认到正式库，请先点击「确认」');
  }
  if (detail.source_type === 'agent_sqlite') {
    throw new Error('该智能体 SQLite 已在本地完成 DS 解析，尚未完成 Supabase 用户关联与字段映射，暂不能上传');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(detail.content.toString('utf8'));
  } catch {
    throw new Error('聊天记录文件不是合法 JSON');
  }

  const sourceRows = extractChatRows(payload);
  const normalized = sourceRows.map(normalizeChatMessage).filter((row): row is Record<string, unknown> => row !== null);
  if (normalized.length === 0) throw new Error('没有可上传的聊天记录：每行至少需要手机号');

  for (const row of normalized) {
    if (!row.wechat_msg_id) {
      row.wechat_msg_id = 'import:' + createHash('sha1').update(JSON.stringify(row.raw_content ?? row)).digest('hex');
    }
  }

  const client = getSupabaseClient();
  const phones = [...new Set(normalized.map((row) => String(row.phone_snapshot || '')).filter(Boolean))];
  if (phones.length > 0) {
    const { data: users, error: userError } = await client
      .from(tableName('user_info'))
      .select('id, phone')
      .in('phone', phones);
    if (userError) throw new Error('按手机号关联 user_info 失败：' + userError.message);
    const userIdByPhone = new Map((users ?? []).map((user) => [String(user.phone), user.id]));
    for (const row of normalized) {
      row.user_id = userIdByPhone.get(String(row.phone_snapshot || '')) ?? null;
    }
  }

  for (let i = 0; i < normalized.length; i += 200) {
    const chunk = normalized.slice(i, i + 200);
    const { error } = await client
      .from(tableName('chat_message'))
      .upsert(chunk, { onConflict: 'wechat_msg_id', ignoreDuplicates: true });
    if (error) throw new Error(`上传聊天记录到数据库失败：${error.message}`);
  }

  const existing = await localGetRecord<StoredChatRecordFile>(STORE, name);
  if (!existing) throw new Error('聊天记录文件不存在');
  const now = new Date().toISOString();
  await localPutRecord<StoredChatRecordFile>(STORE, {
    ...existing,
    status: 'committed',
    record_count: normalized.length,
    committed_at: now,
    updated_at: now,
  });

  return { inserted: normalized.length, skipped: sourceRows.length - normalized.length };
}

/** 删除已上传数据库的聊天记录文件对应的 chat_message 记录。 */
export async function deleteCommittedChatRecordFile(name: string): Promise<{
  remoteDeleted: boolean;
  deleted: number;
}> {
  const detail = await chatRecordFileGet(name);
  if (!detail) throw new Error('聊天记录文件不存在');
  if (detail.status !== 'committed') {
    return { remoteDeleted: false, deleted: 0 };
  }
  if (!detail.content) throw new Error('聊天记录文件内容为空');

  let payload: unknown;
  try {
    payload = JSON.parse(detail.content.toString('utf8'));
  } catch {
    throw new Error('聊天记录文件不是合法 JSON');
  }
  const normalized = extractChatRows(payload)
    .map(normalizeChatMessage)
    .filter((row): row is Record<string, unknown> => row !== null);
  if (normalized.length === 0) {
    throw new Error('聊天记录文件没有可删除的数据库记录');
  }

  const ids = normalized.map((row) => {
    if (row.wechat_msg_id) return String(row.wechat_msg_id);
    return 'import:' + createHash('sha1').update(JSON.stringify(row.raw_content ?? row)).digest('hex');
  });
  const uniqueIds = [...new Set(ids)];
  const client = getSupabaseClient();
  let deleted = 0;
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const chunk = uniqueIds.slice(i, i + 200);
    const { data, error } = await client
      .from(tableName('chat_message'))
      .delete()
      .in('wechat_msg_id', chunk)
      .select('message_id');
    if (error) throw new Error(`删除 ai_teacher_chat_message 中的记录失败：${error.message}`);
    deleted += Array.isArray(data) ? data.length : 0;
  }
  return { remoteDeleted: true, deleted };
}

/** 重命名聊天记录文件，并完整保留内容、解析结果和状态。 */
export async function chatRecordFileRenameFile(oldName: string, newName: string): Promise<void> {
  if (oldName === newName) return;
  const existing = await localGetRecord<StoredChatRecordFile>(STORE, oldName);
  if (!existing) throw new Error('聊天记录文件不存在');
  const target = await localGetRecord<StoredChatRecordFile>(STORE, newName);
  if (target) throw new Error('目标文件名已存在');
  await localPutRecord<StoredChatRecordFile>(STORE, {
    ...existing,
    id: localNewRecordId(newName),
    name: newName,
    updated_at: new Date().toISOString(),
  });
  await localDeleteRecord(STORE, oldName);
}

export async function chatRecordFileDelete(name: string): Promise<boolean> {
  return localDeleteRecord(STORE, name);
}

export async function chatRecordFileStats(): Promise<{
  staging: number;
  formal: number;
  committed: number;
  total: number;
  totalBytes: number;
}> {
  const files = await chatRecordFileList();
  return {
    staging: files.filter((f) => f.status === 'staging').length,
    formal: files.filter((f) => f.status === 'formal').length,
    committed: files.filter((f) => f.status === 'committed').length,
    total: files.length,
    totalBytes: files.reduce((sum, f) => sum + (f.size || 0), 0),
  };
}
