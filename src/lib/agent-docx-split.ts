/**
 * 把已完成的智能体 SQLite DS 解析结果拆成一用户一个 DOCX。
 *
 * 本模块只读取本地 parsed_result，不重新调用 DS，也不写 Supabase。
 */
import {
  chatRecordFileGetParsed,
  chatRecordFilePutImported,
  chatRecordFileSetHidden,
} from './chat-record-files';
import {
  userKbGetParsed,
  userKbPutParsed,
  userKbSetHidden,
} from './user-kb-files';
import {
  DOCX_MIME,
  agentChatDocxFilename,
  agentUserDocxFilename,
  buildFormalChatDocx,
  buildFormalUserDocx,
  userPhoneOf,
} from './user-docx';

const USER_SOURCE_NAME = 'sys_conf_01.db';
const CHAT_SOURCE_NAME = 'extractor.db';
const AGENT_SOURCE_TYPE = 'agent_sqlite';

type JsonRecord = Record<string, unknown>;

interface ParsedEnvelope {
  kind?: unknown;
  source_file?: unknown;
  ds_provider?: unknown;
  ds_model?: unknown;
  records?: unknown;
  source_row_count?: unknown;
}

export interface AgentDocxSplitResult {
  userFiles: number;
  userContacts: number;
  userSourceRows: number;
  chatFiles: number;
  chatSenders: number;
  chatMessages: number;
  excludedSelfMessages: number;
  hiddenOriginals: number;
}

export interface AgentDocxSplitOptions {
  onProgress?: (message: string) => void;
}

export interface AgentUserDocxSplitResult {
  files: number;
  contacts: number;
  sourceRows: number;
}

export interface AgentChatDocxSplitResult {
  files: number;
  senders: number;
  messages: number;
  excludedSelfMessages: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function parsedEnvelope(value: unknown, expectedKind: string): ParsedEnvelope {
  if (!isRecord(value)) throw new Error('本地解析结果格式不正确');
  if (value.kind !== expectedKind) {
    throw new Error(`本地解析结果类型不正确：期望 ${expectedKind}，实际 ${text(value.kind) || '未知'}`);
  }
  if (!Array.isArray(value.records)) throw new Error('本地解析结果缺少 records 数组');
  return value as ParsedEnvelope;
}

function parsedRecords(envelope: ParsedEnvelope): JsonRecord[] {
  return envelope.records instanceof Array ? envelope.records.filter(isRecord) : [];
}

function requiredValue(record: JsonRecord, key: string, label: string): string {
  const value = text(record[key]);
  if (!value) throw new Error(`${label}缺少 ${key}`);
  return value;
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

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function splitAgentUserDocx(
  sourceName: string = USER_SOURCE_NAME,
  options: AgentDocxSplitOptions = {},
): Promise<AgentUserDocxSplitResult> {
  const parsed = parsedEnvelope(await userKbGetParsed(sourceName), 'agent_users');
  const records = parsedRecords(parsed);
  if (records.length === 0) throw new Error('用户解析结果为空');

  const contactIds = records.map((record) => requiredValue(record, 'contact_id', '用户记录'));
  if (new Set(contactIds).size !== contactIds.length) {
    throw new Error('用户解析结果存在重复 contact_id，已停止拆分');
  }
  for (const record of records) {
    if (!isRecord(record.ds)) throw new Error(`联系人 ${text(record.contact_id)} 缺少 DS 解析结果`);
  }

  const dsProvider = text(parsed.ds_provider) || 'ark';
  let completed = 0;
  await mapLimit(records, 4, async (record) => {
    const contactId = requiredValue(record, 'contact_id', '用户记录');
    const filename = agentUserDocxFilename(record);
    const content = await buildFormalUserDocx(record, 'unidentified_agent_user');
    await userKbPutParsed(filename, content, {
      contentType: DOCX_MIME,
      format: 'DOCX',
      dataSource: 'unidentified_agent_user',
      parsedResult: {
        version: 1,
        kind: 'agent_user',
        source_file: text(parsed.source_file) || sourceName,
        source_table: 'contact',
        contact_id: contactId,
        ds_provider: dsProvider,
        ds_model: text(parsed.ds_model) || null,
        record_count: 1,
        generated_at: new Date().toISOString(),
        record,
      },
      recordCount: 1,
      dsProvider,
      sourceType: AGENT_SOURCE_TYPE,
    });
    // 本次导入的智能体字段没有可关联手机号，内容含源字段密文；
    // 保留原始文件用于后续映射，但不混入“用户名称_手机号”正式列表。
    await userKbSetHidden(filename, true);
    completed += 1;
    if (completed % 100 === 0 || completed === records.length) {
      options.onProgress?.(`用户 DOCX：${completed}/${records.length}`);
    }
  });

  await userKbSetHidden(sourceName, true);
  return {
    files: records.length,
    contacts: contactIds.length,
    sourceRows: Number(parsed.source_row_count ?? records.length),
  };
}

interface ChatAggregate {
  sender_id: string;
  sender_name: string;
  phone: string;
  message_count: number;
  chat_count: number;
  group_ids: string[];
  first_send_time: string | null;
  last_send_time: string | null;
  messages: JsonRecord[];
}

function aggregateChats(records: JsonRecord[]): {
  aggregates: ChatAggregate[];
  selfMessages: number;
} {
  const bySender = new Map<string, ChatAggregate>();
  let selfMessages = 0;

  for (const row of records) {
    const senderId = text(row.sender_id);
    if (!senderId) throw new Error(`聊天消息 ${text(row.id) || '(无 ID)'} 缺少 sender_id`);
    if (senderId === 'self') {
      selfMessages += 1;
      continue;
    }

    let aggregate = bySender.get(senderId);
    if (!aggregate) {
      aggregate = {
        sender_id: senderId,
        sender_name: text(row.sender_name) || senderId,
        phone: userPhoneOf(row),
        message_count: 0,
        chat_count: 0,
        group_ids: [],
        first_send_time: null,
        last_send_time: null,
        messages: [],
      };
      bySender.set(senderId, aggregate);
    }

    if (!aggregate.sender_name && text(row.sender_name)) aggregate.sender_name = text(row.sender_name);
    if (!aggregate.phone) aggregate.phone = userPhoneOf(row);
    aggregate.messages.push(row);
    aggregate.message_count += 1;
  }

  for (const aggregate of bySender.values()) {
    const sessions = new Set<string>();
    const times: string[] = [];
    for (const row of aggregate.messages) {
      const sessionId = text(row.session_id);
      if (sessionId) sessions.add(sessionId);
      const sendTime = text(row.send_time);
      if (sendTime) times.push(sendTime);
    }
    aggregate.chat_count = sessions.size;
    aggregate.group_ids = [...sessions];
    times.sort();
    aggregate.first_send_time = times[0] ?? null;
    aggregate.last_send_time = times.at(-1) ?? null;
    aggregate.messages.sort((left, right) => {
      const timeCompare = text(left.send_time).localeCompare(text(right.send_time));
      return timeCompare || text(left.id).localeCompare(text(right.id));
    });
  }

  const aggregates = [...bySender.values()].sort((left, right) =>
    left.sender_name.localeCompare(right.sender_name, 'zh-CN') || left.sender_id.localeCompare(right.sender_id),
  );
  return { aggregates, selfMessages };
}

export async function splitAgentChatDocx(
  sourceName: string = CHAT_SOURCE_NAME,
  options: AgentDocxSplitOptions = {},
): Promise<AgentChatDocxSplitResult> {
  const parsed = parsedEnvelope(await chatRecordFileGetParsed(sourceName), 'agent_chats');
  const records = parsedRecords(parsed);
  if (records.length === 0) throw new Error('聊天解析结果为空');
  if (records.some((record) => !isRecord(record.ds))) {
    throw new Error('聊天解析结果存在缺少 DS 解析结果的消息，已停止拆分');
  }

  const { aggregates, selfMessages } = aggregateChats(records);
  if (aggregates.length === 0) throw new Error('排除 self 后没有可生成文件的发送者');

  const dsProvider = text(parsed.ds_provider) || 'ark';
  let completed = 0;
  await mapLimit(aggregates, 4, async (aggregate) => {
    const filename = agentChatDocxFilename(aggregate.sender_name, aggregate.sender_id, aggregate.phone);
    const content = await buildFormalChatDocx(aggregate, text(parsed.source_file) || sourceName);
    await chatRecordFilePutImported(filename, content, {
      contentType: DOCX_MIME,
      format: 'DOCX',
      recordCount: aggregate.message_count,
      parsedResult: {
        version: 1,
        kind: 'agent_chat_user',
        source_file: text(parsed.source_file) || sourceName,
        source_table: 'message',
        ds_provider: dsProvider,
        ds_model: text(parsed.ds_model) || null,
        record_count: aggregate.message_count,
        generated_at: new Date().toISOString(),
        ...aggregate,
      },
      dsProvider,
      sourceType: AGENT_SOURCE_TYPE,
    });
    completed += 1;
    options.onProgress?.(`聊天 DOCX：${completed}/${aggregates.length}`);
  });

  await chatRecordFileSetHidden(sourceName, true);
  return {
    files: aggregates.length,
    senders: aggregates.length,
    messages: records.length - selfMessages,
    excludedSelfMessages: selfMessages,
  };
}

/** 执行一次完整拆分；已完成的 DS 结果不会重新调用模型。 */
export async function splitAgentDocx(options: AgentDocxSplitOptions = {}): Promise<AgentDocxSplitResult> {
  options.onProgress?.('读取本地 DS 解析结果');
  const users = await splitAgentUserDocx(USER_SOURCE_NAME, options);
  const chats = await splitAgentChatDocx(CHAT_SOURCE_NAME, options);
  return {
    userFiles: users.files,
    userContacts: users.contacts,
    userSourceRows: users.sourceRows,
    chatFiles: chats.files,
    chatSenders: chats.senders,
    chatMessages: chats.messages,
    excludedSelfMessages: chats.excludedSelfMessages,
    hiddenOriginals: 2,
  };
}

