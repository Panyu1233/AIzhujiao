/**
 * 智能体 SQLite 导入与 DS 解析。
 *
 * - 用户库：tbl_bot_contacts，按 contact_id 聚合成一个联系人一条记录。
 * - 聊天库：tbl_extractor_msg_buffer，读取全部消息并逐条做 DS 轻量语义解析。
 *
 * 导入只写项目本地存储，不写 Supabase。DS 解析完成后立即按用户拆分 DOCX：
 * 用户库一个 contact_id 一个文件；聊天库一个 sender_id 汇总一个文件。
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chatRecordFilePutImported } from './chat-record-files';
import { userKbPutFile, userKbUpdateStatus } from './user-kb-files';
import {
  callDsJson,
  getDsEndpoint,
  getDsProvider,
  isDsConfigured,
} from './user-kb-process';
import { splitAgentChatDocx, splitAgentUserDocx } from './agent-docx-split';

const USER_TABLE = 'tbl_bot_contacts';
const CHAT_TABLE = 'tbl_extractor_msg_buffer';
const SESSION_TABLE = 'tbl_extractor_session_state';
const SQLITE_MIME = 'application/vnd.sqlite3';

const USER_COLUMNS = [
  'id',
  'bot_id',
  'contact_id',
  'account',
  'nickname',
  'markname',
  'c_type',
  'avatar',
  'sys_remark',
  'sys_labels',
  'sys_group',
  'sys_desc',
  'lag',
  'country',
  'province',
  'city',
  'sex',
] as const;

const CHAT_COLUMNS = [
  'id',
  'bot_wxid',
  'session_id',
  'chat_type',
  'msg_id',
  'msg_time',
  'sender_id',
  'sender_name',
  'content',
  'inserted_at',
  'seq',
] as const;

const SESSION_COLUMNS = [
  'bot_wxid',
  'session_id',
  'chat_type',
  'last_extract_at',
  'last_extract_msg_id',
  'window_size',
  'enabled',
  'created_at',
] as const;

type JsonRecord = Record<string, unknown>;

interface AggregatedUserContact {
  contact_id: string;
  bot_ids: string[];
  source_row_ids: unknown[];
  accounts: string[];
  bot_profiles: JsonRecord[];
  account: unknown;
  nickname: unknown;
  markname: unknown;
  c_type: unknown;
  avatar: unknown;
  sys_remark: unknown;
  sys_labels: unknown;
  sys_group: unknown;
  sys_desc: unknown;
  lag: unknown;
  country: unknown;
  province: unknown;
  city: unknown;
  sex: unknown;
}

export interface AgentUserSqliteImportResult {
  name: string;
  kind: 'agent_users';
  recordCount: number;
  sourceRowCount: number;
  dsProvider: 'ark' | 'deepseek';
  dsModel: string;
  dsBatches: number;
  docxFiles: number;
  storedLocally: true;
  supabaseWritten: false;
}

export interface AgentChatSqliteImportResult {
  name: string;
  kind: 'agent_chats';
  recordCount: number;
  sourceRowCount: number;
  dsProvider: 'ark' | 'deepseek';
  dsModel: string;
  dsBatches: number;
  docxFiles: number;
  chatSenders: number;
  excludedSelfMessages: number;
  storedLocally: true;
  supabaseWritten: false;
}

export type AgentSqliteImportResult = AgentUserSqliteImportResult | AgentChatSqliteImportResult;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function nullableText(value: unknown): string | null {
  return text(value) || null;
}

function normalizeSqliteRow(row: unknown): JsonRecord {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return {};
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (typeof value === 'bigint') return [key, value.toString()];
      if (Buffer.isBuffer(value)) return [key, value.toString('base64')];
      return [key, value];
    }),
  );
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractDsRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ['records', 'items', 'rows', 'data', 'list']) {
    const rows = value[key];
    if (Array.isArray(rows)) return rows.filter(isRecord);
  }
  return [];
}

function stringList(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean).slice(0, limit);
}

function boolValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, () => worker()),
  );
  return results;
}

async function callDsWithSplit<T>(
  items: T[],
  task: (batch: T[]) => Promise<Map<string, unknown>>,
  onRetry: () => void,
): Promise<Map<string, unknown>> {
  onRetry();
  try {
    return await task(items);
  } catch (error) {
    const retryable = error instanceof Error
      && /DS 模型.*(?:合法 JSON|可解析 JSON)|返回内容为空/.test(error.message);
    if (items.length <= 1 || !retryable) throw error;
    const midpoint = Math.ceil(items.length / 2);
    const [left, right] = await Promise.all([
      callDsWithSplit(items.slice(0, midpoint), task, onRetry),
      callDsWithSplit(items.slice(midpoint), task, onRetry),
    ]);
    return new Map([...left, ...right]);
  }
}

async function withTemporaryDatabase<T>(
  buffer: Buffer,
  sourceName: string,
  task: (db: DatabaseSync) => Promise<T> | T,
): Promise<T> {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-zhujiao-sqlite-'));
  const basename = path.basename(sourceName || 'agent-import.db');
  const filename = /\.(db|sqlite|sqlite3)$/i.test(basename) ? basename : 'agent-import.db';
  const databasePath = path.join(temporaryDir, filename);
  let database: DatabaseSync | null = null;

  try {
    await fs.writeFile(databasePath, buffer);
    database = new DatabaseSync(databasePath, { readOnly: true });
    database.exec('PRAGMA query_only = ON');
    return await task(database);
  } finally {
    try {
      database?.close();
    } finally {
      await fs.rm(temporaryDir, { recursive: true, force: true });
    }
  }
}

function assertRequiredColumns(db: DatabaseSync, table: string, required: readonly string[]): void {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all().map(normalizeSqliteRow);
  if (rows.length === 0) throw new Error(`SQLite 中缺少业务表 ${table}`);
  const columns = new Set(rows.map((row) => text(row.name)));
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(`${table} 缺少必要字段：${missing.join(', ')}`);
  }
}

function selectColumns(columns: readonly string[]): string {
  return columns.map((column) => `"${column}"`).join(', ');
}

function readRows(db: DatabaseSync, sql: string): JsonRecord[] {
  return db.prepare(sql).all().map(normalizeSqliteRow);
}

const USER_DS_PROMPT = `你是智能体联系人资料解析助手。输入是同一批联系人记录，请逐条生成结构化画像。
必须遵守：
1. 只依据输入字段，不得编造手机号、身份证、真实姓名、openid、unionid、年龄、生日、地址或用户关系。
2. 每条输入必须对应输出一条，contact_id 必须原样返回。
3. 无法判断的字符串字段填 null，数组字段无内容时返回 []。
4. profile_summary 不超过80个汉字；persona_tags 最多5个短标签；customer_segment 使用“高意向客户/普通咨询客户/沉默用户/信息不足”之一。
5. 输出只返回合法 JSON 对象，结构为：
{"records":[{"contact_id":"string","profile_summary":"string|null","persona_tags":["string"],"customer_segment":"string|null","communication_style":"string|null","data_quality":"complete|partial|sparse","notes":"string|null"}]}`;

function userDsInput(contact: AggregatedUserContact): JsonRecord {
  return {
    contact_id: contact.contact_id,
    nickname: contact.nickname,
    account: contact.account,
    markname: contact.markname,
    c_type: contact.c_type,
    sys_remark: contact.sys_remark,
    sys_labels: contact.sys_labels,
    sys_group: contact.sys_group,
    sys_desc: contact.sys_desc,
    country: contact.country,
    province: contact.province,
    city: contact.city,
    sex: contact.sex,
    bot_count: contact.bot_ids.length,
  };
}

async function parseUserBatch(batch: AggregatedUserContact[]): Promise<Map<string, unknown>> {
  const response = await callDsJson(
    USER_DS_PROMPT,
    `本批共 ${batch.length} 条联系人记录：\n${JSON.stringify(batch.map(userDsInput))}`,
    { maxTokens: 8000 },
  );
  const records = new Map<string, unknown>();
  for (const record of extractDsRecords(response)) {
    const contactId = text(record.contact_id);
    if (!contactId) continue;
    records.set(contactId, {
      contact_id: contactId,
      profile_summary: nullableText(record.profile_summary),
      persona_tags: stringList(record.persona_tags),
      customer_segment: nullableText(record.customer_segment),
      communication_style: nullableText(record.communication_style),
      data_quality: nullableText(record.data_quality),
      notes: nullableText(record.notes),
    });
  }
  return records;
}

async function parseUsersWithDs(contacts: AggregatedUserContact[]): Promise<{
  byId: Map<string, unknown>;
  batches: number;
}> {
  if (!isDsConfigured()) {
    throw new Error('DS 模型未配置：请配置 ARK_API_KEY 或 DS_API_KEY 后再导入');
  }

  let batches = 0;
  const byId = new Map<string, unknown>();
  const firstPass = chunks(contacts, 20);
  for (const batchResult of await mapLimit(firstPass, 4, (batch) =>
    callDsWithSplit(batch, parseUserBatch, () => { batches += 1; }))) {
    for (const [contactId, parsed] of batchResult.entries()) byId.set(contactId, parsed);
  }

  const missing = contacts.filter((contact) => !byId.has(text(contact.contact_id)));
  if (missing.length > 0) {
    for (const batchResult of await mapLimit(chunks(missing, 15), 2, (batch) =>
      callDsWithSplit(batch, parseUserBatch, () => { batches += 1; }))) {
      for (const [contactId, parsed] of batchResult.entries()) byId.set(contactId, parsed);
    }
  }

  const stillMissing = contacts.filter((contact) => !byId.has(text(contact.contact_id)));
  if (stillMissing.length > 0) {
    throw new Error(`DS 未返回 ${stillMissing.length} 条联系人结果，已停止导入以避免静默丢失`);
  }
  return { byId, batches };
}

function aggregateUsers(rows: JsonRecord[]): AggregatedUserContact[] {
  const byContact = new Map<string, AggregatedUserContact>();

  for (const rawRow of rows) {
    const row = normalizeSqliteRow(rawRow);
    const contactId = text(row.contact_id) || `row:${text(row.id)}`;
    let contact = byContact.get(contactId);
    if (!contact) {
      contact = {
        contact_id: contactId,
        bot_ids: [],
        source_row_ids: [],
        accounts: [],
        bot_profiles: [],
        account: null,
        nickname: null,
        markname: null,
        c_type: null,
        avatar: null,
        sys_remark: null,
        sys_labels: null,
        sys_group: null,
        sys_desc: null,
        lag: null,
        country: null,
        province: null,
        city: null,
        sex: null,
      };
      byContact.set(contactId, contact);
    }

    const botId = text(row.bot_id);
    if (botId && !contact.bot_ids.includes(botId)) contact.bot_ids.push(botId);
    contact.source_row_ids.push(row.id);

    const account = text(row.account);
    if (account && !contact.accounts.includes(account)) contact.accounts.push(account);

    for (const field of [
      'account',
      'nickname',
      'markname',
      'c_type',
      'avatar',
      'sys_remark',
      'sys_labels',
      'sys_group',
      'sys_desc',
      'lag',
      'country',
      'province',
      'city',
      'sex',
    ] as const) {
      if ((contact[field] === null || contact[field] === undefined || contact[field] === '')
        && row[field] !== null && row[field] !== undefined && row[field] !== '') {
        contact[field] = row[field];
      }
    }
    contact.bot_profiles.push(row);
  }

  return [...byContact.values()].map((contact) => {
    const gender = Number(contact.sex);
    return {
      ...contact,
      nick_name: nullableText(contact.nickname),
      avatar_url: nullableText(contact.avatar),
      gender: gender === 1 || gender === 2 ? gender : 0,
      location: [text(contact.province), text(contact.city)].filter(Boolean).join('/') || null,
      phone: null,
      phone_present: false,
      identity_note: '原始库没有手机号字段；contact_id 仅作来源联系人标识，不等同于 openid/user_id。',
    };
  });
}

/** 导入未标识智能体用户 SQLite；DS 解析后按 contact_id 拆分并保存 DOCX。 */
export async function importUnidentifiedAgentUsersSqlite(
  buffer: Buffer,
  sourceName?: string,
): Promise<AgentUserSqliteImportResult> {
  if (buffer.length === 0) throw new Error('SQLite 文件为空');
  const name = path.basename(sourceName || 'agent-users.db');
  if (!/\.(db|sqlite|sqlite3)$/i.test(name)) {
    throw new Error('仅支持 .db / .sqlite / .sqlite3 文件');
  }

  const source = await withTemporaryDatabase(buffer, name, (db) => {
    assertRequiredColumns(db, USER_TABLE, USER_COLUMNS);
    const rows = readRows(db, `SELECT ${selectColumns(USER_COLUMNS)} FROM "${USER_TABLE}" ORDER BY "id" ASC`);
    return { rows, contacts: aggregateUsers(rows) };
  });

  const { byId, batches } = await parseUsersWithDs(source.contacts);
  const records = source.contacts.map((contact) => ({
    ...contact,
    ds: byId.get(text(contact.contact_id)) ?? null,
  }));
  const dsProvider = getDsProvider();
  const dsModel = getDsEndpoint().model;
  const envelope = {
    version: 1,
    kind: 'agent_users',
    source_file: name,
    source_table: USER_TABLE,
    record_count: records.length,
    source_row_count: source.rows.length,
    generated_at: new Date().toISOString(),
    ds_provider: dsProvider,
    ds_model: dsModel,
    inference_notice: 'DS 仅生成画像、标签与质量提示；原始字段以 records 中的非 ds 字段为准。',
    records,
  };

  await userKbPutFile(name, buffer, {
    contentType: SQLITE_MIME,
    format: 'SQLITE',
    dataSource: 'unidentified_agent_user',
  });
  await userKbUpdateStatus(name, 'parsed', {
    parsedResult: JSON.stringify(envelope),
    recordCount: records.length,
    dsProvider,
  });

  const split = await splitAgentUserDocx(name);
  return {
    name,
    kind: 'agent_users',
    recordCount: records.length,
    sourceRowCount: source.rows.length,
    dsProvider,
    dsModel,
    dsBatches: batches,
    docxFiles: split.files,
    storedLocally: true,
    supabaseWritten: false,
  };
}

const CHAT_DS_PROMPT = `你是智能体聊天记录解析助手。输入是同一批聊天消息，请逐条做轻量语义解析。
必须遵守：
1. 原始库没有消息方向字段，推断的 direction 只能作为推断，不能表述为原始事实。
2. 只依据消息文本，不得编造用户身份、手机号、订单、地址或对话上下文。
3. 每条输入必须对应输出一条，id 必须原样返回。
4. topics 最多4个短标签；summary 不超过60个汉字。
5. msg_type 只使用 text/image/file/voice/video/link/system/unknown；sentiment 只使用 positive/neutral/negative/unknown。
6. inferred_direction 只使用 user/agent/unknown。
7. 输出只返回合法 JSON 对象，结构为：
{"records":[{"id":"string","msg_type":"string","summary":"string|null","intent":"string|null","topics":["string"],"sentiment":"string","is_sensitive":false,"inferred_direction":"user|agent|unknown","memory_candidate":false,"notes":"string|null"}]}`;

function chatDsInput(message: JsonRecord): JsonRecord {
  return {
    id: message.id,
    chat_type: message.chat_type,
    sender_name: message.sender_name,
    content: message.content,
    send_time: message.send_time,
  };
}

async function parseChatBatch(batch: JsonRecord[]): Promise<Map<string, unknown>> {
  const response = await callDsJson(
    CHAT_DS_PROMPT,
    `本批共 ${batch.length} 条聊天消息：\n${JSON.stringify(batch.map(chatDsInput))}`,
    { maxTokens: 8000 },
  );
  const records = new Map<string, unknown>();
  for (const record of extractDsRecords(response)) {
    const id = text(record.id);
    if (!id) continue;
    records.set(id, {
      id,
      msg_type: nullableText(record.msg_type),
      summary: nullableText(record.summary),
      intent: nullableText(record.intent),
      topics: stringList(record.topics, 4),
      sentiment: nullableText(record.sentiment),
      is_sensitive: boolValue(record.is_sensitive),
      inferred_direction: nullableText(record.inferred_direction),
      memory_candidate: boolValue(record.memory_candidate),
      notes: nullableText(record.notes),
    });
  }
  return records;
}

async function parseChatsWithDs(messages: JsonRecord[]): Promise<{
  byId: Map<string, unknown>;
  batches: number;
}> {
  if (!isDsConfigured()) {
    throw new Error('DS 模型未配置：请配置 ARK_API_KEY 或 DS_API_KEY 后再导入');
  }

  let batches = 0;
  const byId = new Map<string, unknown>();
  for (const batchResult of await mapLimit(chunks(messages, 15), 3, (batch) =>
    callDsWithSplit(batch, parseChatBatch, () => { batches += 1; }))) {
    for (const [id, parsed] of batchResult.entries()) byId.set(id, parsed);
  }

  const missing = messages.filter((message) => !byId.has(text(message.id)));
  if (missing.length > 0) {
    for (const batchResult of await mapLimit(chunks(missing, 5), 2, (batch) =>
      callDsWithSplit(batch, parseChatBatch, () => { batches += 1; }))) {
      for (const [id, parsed] of batchResult.entries()) byId.set(id, parsed);
    }
  }

  const stillMissing = messages.filter((message) => !byId.has(text(message.id)));
  if (stillMissing.length > 0) {
    throw new Error(`DS 未返回 ${stillMissing.length} 条聊天消息结果，已停止导入以避免静默丢失`);
  }
  return { byId, batches };
}

function parseMessageTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    const date = new Date(raw.length <= 10 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sessionKey(botWxid: unknown, sessionId: unknown): string {
  return `${text(botWxid)}\u0000${text(sessionId)}`;
}

/** 导入智能体聊天 SQLite；DS 解析后按 sender_id 汇总并保存 DOCX。 */
export async function importAgentChatSqlite(
  buffer: Buffer,
  sourceName?: string,
): Promise<AgentChatSqliteImportResult> {
  if (buffer.length === 0) throw new Error('SQLite 文件为空');
  const name = path.basename(sourceName || 'agent-chat.db');
  if (!/\.(db|sqlite|sqlite3)$/i.test(name)) {
    throw new Error('仅支持 .db / .sqlite / .sqlite3 文件');
  }

  const source = await withTemporaryDatabase(buffer, name, (db) => {
    assertRequiredColumns(db, CHAT_TABLE, CHAT_COLUMNS);
    let sessions: JsonRecord[] = [];
    const sessionTable = db.prepare(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    ).get(SESSION_TABLE);
    if (sessionTable) {
      assertRequiredColumns(db, SESSION_TABLE, SESSION_COLUMNS);
      sessions = readRows(db, `SELECT ${selectColumns(SESSION_COLUMNS)} FROM "${SESSION_TABLE}"`);
    }
    const messages = readRows(
      db,
      `SELECT ${selectColumns(CHAT_COLUMNS)} FROM "${CHAT_TABLE}" ORDER BY "msg_time" ASC, "id" ASC`,
    );
    return { messages, sessions };
  });

  const sessionsByKey = new Map<string, JsonRecord>();
  for (const session of source.sessions) {
    sessionsByKey.set(sessionKey(session.bot_wxid, session.session_id), session);
  }

  const messages: JsonRecord[] = source.messages.map((message) => {
    const chatType = text(message.chat_type).toLowerCase();
    const normalizedChatType = chatType === '2' || chatType === 'group'
      ? 'group'
      : chatType === '1' || chatType === 'private'
        ? 'private'
        : chatType || 'unknown';
    return {
      ...message,
      chat_type_raw: message.chat_type,
      chat_type: normalizedChatType,
      send_time_raw: message.msg_time,
      send_time: parseMessageTime(message.msg_time),
      session_state: sessionsByKey.get(sessionKey(message.bot_wxid, message.session_id)) ?? null,
      direction_is_inferred: true,
    };
  });

  const invalidTimes = messages.filter((message) => !message.send_time).map((message) => message.id);
  if (invalidTimes.length > 0) {
    throw new Error(`有 ${invalidTimes.length} 条聊天消息时间无法解析，已停止导入`);
  }

  const { byId, batches } = await parseChatsWithDs(messages);
  const records: JsonRecord[] = messages.map((message) => ({
    ...message,
    ds: byId.get(text(message.id)) ?? null,
    ds_inference_notice: 'ds 中的方向、敏感性和意图均为模型推断；原始库没有这些字段。',
  }));
  const dsProvider = getDsProvider();
  const dsModel = getDsEndpoint().model;
  const envelope = {
    version: 1,
    kind: 'agent_chats',
    source_file: name,
    source_table: CHAT_TABLE,
    session_table: source.sessions.length > 0 ? SESSION_TABLE : null,
    record_count: records.length,
    session_count: new Set(records.map((record) => sessionKey(record.bot_wxid, record.session_id))).size,
    sender_count: new Set(records.map((record) => text(record.sender_id)).filter(Boolean)).size,
    generated_at: new Date().toISOString(),
    ds_provider: dsProvider,
    ds_model: dsModel,
    inference_notice: '方向、敏感性、意图、话题和记忆候选均由 DS 推断，不是原始库事实。',
    records,
  };

  await chatRecordFilePutImported(name, buffer, {
    contentType: SQLITE_MIME,
    format: 'SQLITE',
    recordCount: records.length,
    parsedResult: envelope,
    dsProvider,
    sourceType: 'agent_sqlite',
  });

  const split = await splitAgentChatDocx(name);
  return {
    name,
    kind: 'agent_chats',
    recordCount: records.length,
    sourceRowCount: source.messages.length,
    dsProvider,
    dsModel,
    dsBatches: batches,
    docxFiles: split.files,
    chatSenders: split.senders,
    excludedSelfMessages: split.excludedSelfMessages,
    storedLocally: true,
    supabaseWritten: false,
  };
}