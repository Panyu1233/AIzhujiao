import { createHash } from 'node:crypto';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  HeightRule,
  PageOrientation,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from 'docx';
import type { UserDataSource } from './user-kb-files';
import {
  CHAT_MESSAGE_DOCX_FIELDS,
  USER_INFO_DOCX_FIELDS,
  type FormalDocxField,
} from './formal-docx-schema';

type JsonRecord = Record<string, unknown>;

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const EM_DASH = '—';
const TABLE_WIDTH = 15250;
const USER_COLUMN_WIDTHS = [2050, 1450, 900, 1000, 4850, 5000] as const;
const DEFINITION_COLUMN_WIDTHS = [2800, 1800, 1000, 1400, 8250] as const;
const MESSAGE_FIELD_COLUMN_WIDTHS = [2300, 5325, 2300, 5325] as const;
const AI_COLUMN_WIDTHS = [600, 800, 3400, 2200, 2800, 1500, 1000, 1400, 1550] as const;
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'A6A6A6' } as const;
const HEADER_FILL = '1F4E78';
const LABEL_FILL = 'DCE6F1';
const ALT_FILL = 'F3F6FA';
const TABLE_BORDERS = {
  top: CELL_BORDER,
  bottom: CELL_BORDER,
  left: CELL_BORDER,
  right: CELL_BORDER,
  insideHorizontal: CELL_BORDER,
  insideVertical: CELL_BORDER,
};
const BODY_FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: '等线', cs: 'Calibri' };
const HEADER_FONT = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: '等线', cs: 'Arial' };

const SOURCE_LABELS: Record<UserDataSource, string> = {
  gulesi_mini_program: '谷乐斯小程序 / Gulesi mini-program',
  agent_api: '智能体 API / Agent API',
  unidentified_agent_user: '未标识的智能体用户 / Unidentified agent user',
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function pathValue(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split('.')) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function firstPath(value: unknown, paths: readonly string[]): unknown {
  for (const path of paths) {
    const candidate = pathValue(value, path);
    if (hasValue(candidate)) return candidate;
  }
  return undefined;
}

function safePart(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');
  return cleaned.slice(0, 80) || fallback;
}

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 8);
}

function compactId(value: string): string {
  return safePart(value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10), 'no-id');
}

/** 从外部用户数据中提取手机号，兼容常见字段名和嵌套结构。 */
export function userPhoneOf(row: JsonRecord): string {
  const direct = firstPath(row, [
    'phone',
    'mobile',
    'phoneNumber',
    'mobilePhone',
    'phone_snapshot',
    'profile.basic.phone',
    'profile.phone',
    'basic.phone',
    'user.phone',
    'customer.phone',
    'contact.phone',
  ]);
  return textValue(direct);
}

/** 优先取昵称，其次取真实姓名。 */
export function userDisplayNameOf(row: JsonRecord): string {
  const direct = firstPath(row, [
    'nick_name',
    'nickName',
    'nickname',
    'profile.basic.nickname',
    'profile.nickname',
    'basic.nickname',
    'real_name',
    'realName',
    'name',
    'profile.basic.name',
    'markname',
  ]);
  return textValue(direct);
}

/** 文件名为：昵称_手机号.docx；同一手机号更新时覆盖同一文件。 */
export function userDocxFilename(row: JsonRecord, source: UserDataSource): string {
  void source;
  const nickname = userDisplayNameOf(row);
  const phone = userPhoneOf(row);
  return `${safePart(nickname, '未命名用户')}_${safePart(phone, '未识别手机号')}.docx`;
}

/** 智能体联系人：文件名优先使用“显示名称_手机号”，无手机号时回退到来源标识。 */
export function agentUserDocxFilename(row: JsonRecord): string {
  const contactId = textValue(row.contact_id) || JSON.stringify(row);
  const markname = textValue(row.markname);
  const nickname = textValue(row.nick_name) || textValue(row.nickname);
  const type = textValue(row.c_type) || 'unknown';
  const displayName = markname || nickname || `联系人类型${type}`;
  const phone = userPhoneOf(row);
  const identity = phone
    ? safePart(phone, '未识别手机号')
    : `未识别手机号_${compactId(contactId)}_${shortHash(contactId)}`;
  return `${safePart(displayName, '未命名联系人')}_${identity}.docx`;
}

/** 智能体聊天：文件名优先使用“发送者名称_手机号”，无手机号时回退到发送者标识。 */
export function agentChatDocxFilename(senderName: string, senderId: string, phone = ''): string {
  const stableId = senderId || senderName || 'unknown';
  const identity = textValue(phone)
    ? safePart(textValue(phone), '未识别手机号')
    : `未识别手机号_${compactId(stableId)}_${shortHash(stableId)}`;
  return `${safePart(senderName, '未命名用户')}_${identity}.docx`;
}

function formatValue(value: unknown): string {
  if (!hasValue(value)) return EM_DASH;
  if (isRecord(value) || Array.isArray(value)) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return textValue(value) || EM_DASH;
    }
  }
  return textValue(value) || EM_DASH;
}

function looksLikeMiniProgram(row: JsonRecord): boolean {
  return isRecord(row.profile)
    || hasValue(row.health_weight_kg)
    || hasValue(row.scale_weight_kg)
    || hasValue(row.health_questionnaire_raw)
    || hasValue(row.first_source_group_id);
}

function userFieldValues(row: JsonRecord): Record<string, unknown> {
  const ds = isRecord(row.ds) ? row.ds : null;
  const miniData = firstPath(row, ['mini_program_data'])
    ?? (looksLikeMiniProgram(row) ? row : undefined);
  return {
    id: firstPath(row, ['id', 'profile.id', 'user_info.id']),
    openid: firstPath(row, ['openid', 'open_id', 'profile.basic.openid', 'profile.openid', 'basic.openid']),
    unionid: firstPath(row, ['unionid', 'union_id', 'profile.basic.unionid', 'profile.unionid']),
    phone: userPhoneOf(row),
    wechat_no: firstPath(row, ['wechat_no', 'wechatNo', 'profile.basic.wechat_no', 'profile.wechat_no']),
    nickname: userDisplayNameOf(row),
    avatar_url: firstPath(row, [
      'avatar_url',
      'avatarUrl',
      'avatar',
      'profile.basic.avatar_url',
      'profile.avatar_url',
      'basic.avatar_url',
    ]),
    wechat_group_id: firstPath(row, [
      'wechat_group_id',
      'group_id',
      'group_ids.0',
      'first_source_group_id',
      'profile.wechat_group_id',
      'profile.basic.wechat_group_id',
    ]),
    wechat_group_name: firstPath(row, [
      'wechat_group_name',
      'group_name',
      'first_source_group_name',
      'profile.wechat_group_name',
      'profile.basic.wechat_group_name',
    ]),
    wechat_group_nickname: firstPath(row, [
      'wechat_group_nickname',
      'group_nickname',
      'profile.wechat_group_nickname',
      'profile.basic.wechat_group_nickname',
    ]),
    join_group_time: firstPath(row, [
      'join_group_time',
      'join_group_at',
      'profile.join_group_time',
      'profile.basic.join_group_time',
    ]),
    enroll_status: firstPath(row, [
      'enroll_status',
      'enrollment_status',
      'profile.basic.enrollment_status',
      'profile.enroll_status',
    ]),
    northland_member_id: firstPath(row, [
      'northland_member_id',
      'profile.basic.northland_member_id',
      'profile.northland_member_id',
    ]),
    latest_weight: firstPath(row, [
      'latest_weight',
      'health_weight_kg',
      'scale_weight_kg',
      'profile.basic.latest_weight',
    ]),
    latest_bmi: firstPath(row, ['latest_bmi', 'bmi', 'profile.basic.latest_bmi']),
    latest_body_fat: firstPath(row, [
      'latest_body_fat',
      'body_fat_rate',
      'profile.basic.latest_body_fat',
    ]),
    mini_program_data: miniData,
    ai_memory_summary: firstPath(row, [
      'ai_memory_summary',
      'profile_summary',
      'ds.profile_summary',
      'profile.basic.ai_memory_summary',
    ]),
    ai_memory_json: firstPath(row, ['ai_memory_json', 'ds', 'profile.basic.ai_memory_json']),
    memory_updated_at: firstPath(row, [
      'memory_updated_at',
      'profile.basic.memory_updated_at',
      'profile.memory_updated_at',
    ]),
    created_at: firstPath(row, ['created_at', 'profile.basic.created_at', 'profile.created_at']),
    updated_at: firstPath(row, ['updated_at', 'profile.updated_at', 'profile.basic.updated_at']),
  };
}

function valueLines(value: string): string[] {
  if (!value.trim()) return [EM_DASH];
  return value.split(/\r?\n/);
}

interface CellOptions {
  header?: boolean;
  align?: 'left' | 'center';
  fill?: string;
  size?: number;
  bold?: boolean;
  color?: string;
  keepNext?: boolean;
}

function cellParagraph(lines: string[], options: CellOptions = {}): Paragraph {
  const size = options.size ?? (options.header ? 16 : 18);
  const color = options.color ?? (options.header ? 'FFFFFF' : '000000');
  return new Paragraph({
    alignment: options.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    keepNext: options.keepNext,
    spacing: { before: 0, after: 0, line: options.header ? 220 : 250 },
    children: lines.map((line, index) => new TextRun({
      text: line || EM_DASH,
      font: options.header ? HEADER_FONT : BODY_FONT,
      size,
      bold: options.bold ?? options.header,
      color,
      break: index === 0 ? undefined : 1,
    })),
  });
}

function tableCell(lines: string | string[], width: number, options: CellOptions = {}): TableCell {
  const normalized = Array.isArray(lines) ? lines : [lines];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlignTable.CENTER,
    shading: options.fill ? { fill: options.fill, color: 'auto' } : undefined,
    margins: { top: 55, bottom: 55, left: 90, right: 90 },
    children: [cellParagraph(normalized, options)],
  });
}

function table(rows: TableRow[], widths: readonly number[]): Table {
  return new Table({
    rows,
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: [...widths],
    layout: TableLayoutType.FIXED,
    borders: TABLE_BORDERS,
    alignment: AlignmentType.CENTER,
    margins: { top: 40, bottom: 40, left: 90, right: 90 },
  });
}

function headerRow(headers: string[][], widths: readonly number[], size = 16): TableRow {
  return new TableRow({
    tableHeader: true,
    cantSplit: true,
    height: { value: 440, rule: HeightRule.ATLEAST },
    children: headers.map((header, index) => tableCell(
      header,
      widths[index],
      { header: true, align: 'center', fill: HEADER_FILL, size, keepNext: true },
    )),
  });
}

function title(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.TITLE,
    spacing: { before: 0, after: 220 },
    children: [new TextRun({
      text,
      font: HEADER_FONT,
      size: 36,
      bold: true,
      color: '000000',
    })],
  });
}

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    keepNext: true,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({
      text,
      font: HEADER_FONT,
      size: 25,
      bold: true,
      color: HEADER_FILL,
    })],
  });
}

function paragraph(lines: string[], options: { keepNext?: boolean } = {}): Paragraph {
  return new Paragraph({
    keepNext: options.keepNext,
    spacing: { before: 0, after: 120, line: 300 },
    children: lines.map((line, index) => new TextRun({
      text: line,
      font: BODY_FONT,
      size: 19,
      color: '333333',
      break: index === 0 ? undefined : 1,
    })),
  });
}

function summaryTable(rows: Array<[string, string]>): Table {
  const widths = [3600, 11650] as const;
  return table(rows.map(([label, value], index) => new TableRow({
    cantSplit: false,
    children: [
      tableCell(label.split(/\r?\n/), widths[0], {
        bold: true,
        fill: LABEL_FILL,
        size: 18,
      }),
      tableCell(valueLines(value), widths[1], {
        size: 18,
        fill: index % 2 === 1 ? ALT_FILL : undefined,
      }),
    ],
  })), widths);
}

function definitionTable(definitions: FormalDocxField[]): Table {
  const headers = [
    ['字段', 'Field'],
    ['类型', 'Type'],
    ['必填', 'Required'],
    ['键/索引', 'Key or Index'],
    ['说明', 'Description'],
  ];
  const rows = definitions.map((field, index) => new TableRow({
    cantSplit: true,
    children: [
      tableCell([field.name, `${field.zhLabel} / ${field.enLabel}`], DEFINITION_COLUMN_WIDTHS[0], {
        fill: index % 2 === 1 ? ALT_FILL : undefined,
      }),
      tableCell(field.type, DEFINITION_COLUMN_WIDTHS[1], { align: 'center' }),
      tableCell(field.required, DEFINITION_COLUMN_WIDTHS[2], { align: 'center' }),
      tableCell(field.key, DEFINITION_COLUMN_WIDTHS[3], { align: 'center' }),
      tableCell([field.zhDescription, field.enDescription], DEFINITION_COLUMN_WIDTHS[4]),
    ],
  }));
  return table([headerRow(headers, DEFINITION_COLUMN_WIDTHS), ...rows], DEFINITION_COLUMN_WIDTHS);
}

function userValueTable(values: Record<string, unknown>): Table {
  const headers = [
    ['字段', 'Field'],
    ['类型', 'Type'],
    ['必填', 'Required'],
    ['键/索引', 'Key or Index'],
    ['说明', 'Description'],
    ['用户值', 'User Value'],
  ];
  const rows = USER_INFO_DOCX_FIELDS.map((field, index) => new TableRow({
    cantSplit: true,
    children: [
      tableCell([field.name, `${field.zhLabel} / ${field.enLabel}`], USER_COLUMN_WIDTHS[0], {
        fill: index % 2 === 1 ? ALT_FILL : undefined,
      }),
      tableCell(field.type, USER_COLUMN_WIDTHS[1], { align: 'center' }),
      tableCell(field.required, USER_COLUMN_WIDTHS[2], { align: 'center' }),
      tableCell(field.key, USER_COLUMN_WIDTHS[3], { align: 'center' }),
      tableCell([field.zhDescription, field.enDescription], USER_COLUMN_WIDTHS[4]),
      tableCell(valueLines(formatValue(values[field.name])), USER_COLUMN_WIDTHS[5], { size: 17 }),
    ],
  }));
  return table([headerRow(headers, USER_COLUMN_WIDTHS), ...rows], USER_COLUMN_WIDTHS);
}

function directionValue(message: JsonRecord): string {
  const raw = textValue(firstPath(message, [
    'msg_direction',
    'direction',
    'ds.inferred_direction',
  ])).toLowerCase();
  if (['user', 'customer', 'client'].includes(raw)) return 'user';
  if (['ai', 'agent', 'assistant', 'bot', 'self'].includes(raw)) return 'ai';
  if (['human', 'staff', 'operator'].includes(raw)) return 'human';
  return raw || EM_DASH;
}

function messageFieldValue(message: JsonRecord, field: string): unknown {
  switch (field) {
    case 'message_id':
      return firstPath(message, ['message_id', 'id']);
    case 'wechat_msg_id':
      return firstPath(message, ['wechat_msg_id', 'msg_id']);
    case 'group_id':
      return firstPath(message, ['group_id', 'session_id']);
    case 'group_name_snapshot':
      return firstPath(message, [
        'group_name_snapshot',
        'group_name',
        'session_name',
        'session_state.group_name',
      ]);
    case 'sender_openid':
      return firstPath(message, ['sender_openid', 'sender_id']);
    case 'sender_nickname':
      return firstPath(message, ['sender_nickname', 'sender_name']);
    case 'user_id':
      return firstPath(message, ['user_id']);
    case 'msg_type':
      return firstPath(message, ['msg_type', 'ds.msg_type']);
    case 'content':
      return firstPath(message, ['content', 'raw_content']);
    case 'media_url':
      return firstPath(message, ['media_url', 'mediaUrl', 'file_url']);
    case 'send_time':
      return firstPath(message, ['send_time', 'sendTime', 'msg_time']);
    case 'msg_direction':
      return directionValue(message);
    case 'is_ai_reply': {
      const explicit = firstPath(message, ['is_ai_reply']);
      if (hasValue(explicit)) return explicit;
      return directionValue(message) === 'ai' ? 1 : 0;
    }
    case 'related_knowledge_id':
      return firstPath(message, ['related_knowledge_id']);
    case 'memory_extract_status':
      return firstPath(message, ['memory_extract_status']);
    case 'created_at':
      return firstPath(message, ['created_at', 'inserted_at']);
    default:
      return undefined;
  }
}

function messageCaption(index: number): Paragraph {
  return new Paragraph({
    keepNext: true,
    spacing: { before: index === 0 ? 80 : 240, after: 80 },
    children: [new TextRun({
      text: `消息 ${index + 1} / Message ${index + 1}`,
      font: HEADER_FONT,
      size: 19,
      bold: true,
      color: HEADER_FILL,
    })],
  });
}

function messageFieldsTable(message: JsonRecord): Table {
  const headers = [
    ['字段', 'Field'],
    ['值', 'Value'],
    ['字段', 'Field'],
    ['值', 'Value'],
  ];
  const rows: TableRow[] = [];
  for (let index = 0; index < CHAT_MESSAGE_DOCX_FIELDS.length; index += 2) {
    const left = CHAT_MESSAGE_DOCX_FIELDS[index];
    const right = CHAT_MESSAGE_DOCX_FIELDS[index + 1];
    const keepNext = index + 2 < CHAT_MESSAGE_DOCX_FIELDS.length;
    rows.push(new TableRow({
      cantSplit: true,
      children: [
        tableCell([left.name, `${left.zhLabel} / ${left.enLabel}`], MESSAGE_FIELD_COLUMN_WIDTHS[0], {
          bold: true,
          fill: LABEL_FILL,
          size: 16,
          keepNext,
        }),
        tableCell(
          valueLines(formatValue(messageFieldValue(message, left.name))),
          MESSAGE_FIELD_COLUMN_WIDTHS[1],
          { size: 16, keepNext },
        ),
        tableCell(
          right ? [right.name, `${right.zhLabel} / ${right.enLabel}`] : [EM_DASH],
          MESSAGE_FIELD_COLUMN_WIDTHS[2],
          {
            bold: true,
            fill: LABEL_FILL,
            size: 16,
            keepNext,
          },
        ),
        tableCell(
          right ? valueLines(formatValue(messageFieldValue(message, right.name))) : [EM_DASH],
          MESSAGE_FIELD_COLUMN_WIDTHS[3],
          { size: 16, keepNext },
        ),
      ],
    }));
  }
  return table(
    [headerRow(headers, MESSAGE_FIELD_COLUMN_WIDTHS, 16), ...rows],
    MESSAGE_FIELD_COLUMN_WIDTHS,
  );
}

function chatMessageBlocks(messages: JsonRecord[]): Array<Paragraph | Table> {
  return messages.flatMap((message, index) => [
    messageCaption(index),
    messageFieldsTable(message),
  ]);
}

function booleanLabel(value: unknown): string {
  if (!hasValue(value)) return EM_DASH;
  return value === true || value === 1 || value === '1' || value === 'true'
    ? '是 / Yes'
    : '否 / No';
}

function aiAnalysisTable(messages: JsonRecord[]): Table | null {
  const rowsWithDs = messages.filter((message) => isRecord(message.ds));
  if (rowsWithDs.length === 0) return null;
  const headers = [
    ['序号', 'No.'],
    ['消息 ID', 'Message ID'],
    ['摘要', 'Summary'],
    ['意图', 'Intent'],
    ['话题', 'Topics'],
    ['情感', 'Sentiment'],
    ['敏感', 'Sensitive'],
    ['记忆候选', 'Memory Candidate'],
    ['备注', 'Notes'],
  ];
  const rows = rowsWithDs.map((message, index) => {
    const ds = isRecord(message.ds) ? message.ds : {};
    const topics = Array.isArray(ds.topics) ? ds.topics.map(textValue).filter(Boolean).join('、') : ds.topics;
    return new TableRow({
      cantSplit: true,
      children: [
        tableCell(String(index + 1), AI_COLUMN_WIDTHS[0], { align: 'center', size: 14 }),
        tableCell(valueLines(formatValue(firstPath(message, ['message_id', 'id']))), AI_COLUMN_WIDTHS[1], {
          align: 'center',
          size: 14,
        }),
        tableCell(valueLines(formatValue(ds.summary)), AI_COLUMN_WIDTHS[2], { size: 14 }),
        tableCell(valueLines(formatValue(ds.intent)), AI_COLUMN_WIDTHS[3], { size: 14 }),
        tableCell(valueLines(formatValue(topics)), AI_COLUMN_WIDTHS[4], { size: 14 }),
        tableCell(valueLines(formatValue(ds.sentiment)), AI_COLUMN_WIDTHS[5], { size: 14 }),
        tableCell(booleanLabel(ds.is_sensitive), AI_COLUMN_WIDTHS[6], { align: 'center', size: 14 }),
        tableCell(booleanLabel(ds.memory_candidate), AI_COLUMN_WIDTHS[7], { align: 'center', size: 14 }),
        tableCell(valueLines(formatValue(ds.notes)), AI_COLUMN_WIDTHS[8], { size: 14 }),
      ],
    });
  });
  return table([headerRow(headers, AI_COLUMN_WIDTHS, 14), ...rows], AI_COLUMN_WIDTHS);
}

async function buildDocument(titleText: string, children: Array<Paragraph | Table>): Promise<Buffer> {
  const doc = new Document({
    creator: 'AI助教',
    title: titleText,
    description: '依据知识库四表模板生成的单用户 DOCX',
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 19 },
          paragraph: { spacing: { before: 0, after: 0, line: 260 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: { top: 620, right: 620, bottom: 620, left: 620 },
          },
        },
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

function sourceRecordId(row: JsonRecord): string {
  return textValue(firstPath(row, [
    'contact_id',
    'profile.id',
    'id',
    'account',
    'profile.basic.phone',
    'phone',
  ])) || EM_DASH;
}

function sourceDisplayName(row: JsonRecord): string {
  return userDisplayNameOf(row) || textValue(firstPath(row, ['markname', 'profile.basic.name'])) || EM_DASH;
}

/** 生成严格对齐表 1 的单用户正式 DOCX。 */
export async function buildFormalUserDocx(value: unknown, source: UserDataSource): Promise<Buffer> {
  const row = isRecord(value) ? value : {};
  const values = userFieldValues(row);
  const populated = USER_INFO_DOCX_FIELDS.filter(
    (field) => formatValue(values[field.name]) !== EM_DASH,
  ).length;
  const miniSource = looksLikeMiniProgram(row);
  const identityNote = textValue(row.identity_note)
    || (source === 'unidentified_agent_user'
      ? 'contact_id 仅作来源联系人标识，不等同于微信 openid 或 user_info.id。 / contact_id is a source contact identifier, not a verified WeChat openid or user_info.id.'
      : '本文件为单用户资料汇总。 / This document summarizes one user record.');
  const summaryRows: Array<[string, string]> = [
    ['数据来源\nData Source', SOURCE_LABELS[source]],
    ['来源记录标识\nSource Record ID', sourceRecordId(row)],
    ['用户显示名\nDisplay Name', sourceDisplayName(row)],
    ['已填写字段\nPopulated Fields', `${populated} / ${USER_INFO_DOCX_FIELDS.length}`],
    ['数据说明\nData Note', miniSource
      ? '小程序原始数据保存在 mini_program_data 字段中。 / Mini-program source data is retained in mini_program_data.'
      : identityNote],
  ];

  return buildDocument('用户信息表 User Information', [
    title('用户信息表 / User Information'),
    paragraph([
      '本文档按表1“用户信息表 user_info”的 22 个字段顺序整理单个用户，字段名称、类型、必填、键/索引和说明均与模板一致。',
      'This document presents one user in the exact 22-field order of Table 1 (user_info). Field names, types, requirements, keys, and descriptions follow the supplied template.',
      '中英文标签并列显示；源数据不存在的值统一记为 —，不推测或补造身份信息。',
      'Chinese and English labels are shown together. Values absent from the source are recorded as — without inventing identity information.',
    ]),
    summaryTable(summaryRows),
    heading('字段与用户值 / Fields and User Values'),
    userValueTable(values),
  ]);
}

/** 拉取外部 API 时也使用同一套正式模板。 */
export async function buildUserDocx(row: JsonRecord, source: UserDataSource): Promise<Buffer> {
  return buildFormalUserDocx(row, source);
}

interface ChatAggregateRecord extends JsonRecord {
  messages: JsonRecord[];
}

function chatAggregate(value: unknown): ChatAggregateRecord {
  if (!isRecord(value)) throw new Error('聊天聚合数据格式不正确');
  const messages = Array.isArray(value.messages) ? value.messages.filter(isRecord) : [];
  if (messages.length === 0) throw new Error('聊天聚合数据不含消息');
  return { ...value, messages };
}

function chatTimeRange(messages: JsonRecord[]): string {
  const times = messages
    .map((message) => textValue(firstPath(message, ['send_time', 'sendTime', 'msg_time'])))
    .filter(Boolean)
    .sort();
  if (times.length === 0) return EM_DASH;
  return times[0] === times.at(-1) ? times[0] : `${times[0]} — ${times.at(-1)}`;
}

/** 生成严格对齐表 2 的单发送者聚合聊天 DOCX。 */
export async function buildFormalChatDocx(value: unknown, sourceName = ''): Promise<Buffer> {
  const aggregate = chatAggregate(value);
  const messages = aggregate.messages;
  const senderId = textValue(firstPath(aggregate, ['sender_id'])) || EM_DASH;
  const senderName = textValue(firstPath(aggregate, ['sender_name'])) || EM_DASH;
  const groupIds = firstPath(aggregate, ['group_ids']);
  const groupCount = Array.isArray(groupIds)
    ? new Set(groupIds.map(textValue).filter(Boolean)).size
    : new Set(messages.map((message) => textValue(firstPath(message, ['group_id', 'session_id']))).filter(Boolean)).size;
  const summaryRows: Array<[string, string]> = [
    ['发送者标识\nSender ID', senderId],
    ['发送者昵称\nSender Name', senderName],
    ['消息数量\nMessage Count', String(messages.length)],
    ['会话数量\nConversation Count', String(groupCount)],
    ['时间范围\nTime Range', chatTimeRange(messages)],
    ['来源文件\nSource File', sourceName || textValue(firstPath(aggregate, ['source_file'])) || EM_DASH],
  ];

  const children: Array<Paragraph | Table> = [
    title('单用户聊天记录表 / Single-user Chat Records'),
    paragraph([
      '本文档按表2“单用户聊天记录表 chat_message”的 16 个字段整理同一发送者在全部会话中的聊天记录，消息按发送时间升序排列。',
      'This document organizes all messages from one sender across all conversations using the 16-field Table 2 (chat_message) template. Messages are sorted by send time in ascending order.',
      'sender_openid 当前填写来源 sender_id，仅作为发送者标识，不等同于已验证的微信 OpenID；user_id、media_url、related_knowledge_id 等缺失字段统一记为 —。',
      'sender_openid currently contains the source sender_id as an identifier only; it is not a verified WeChat OpenID. Missing fields such as user_id, media_url, and related_knowledge_id are recorded as —.',
    ]),
    summaryTable(summaryRows),
    heading('字段定义 / Field Definitions'),
    definitionTable(CHAT_MESSAGE_DOCX_FIELDS),
    heading('消息明细 / Message Details'),
    ...chatMessageBlocks(messages),
  ];
  const analysis = aiAnalysisTable(messages);
  if (analysis) {
    children.push(
      heading('AI 补充解析（推断） / AI Analysis (Inferred)'),
      paragraph([
        '下表仅展示 DS 对消息的补充解析，属于模型推断，不作为原始聊天事实。',
        'The table below contains supplemental DS analysis. These values are model inferences, not original chat facts.',
      ], { keepNext: true }),
      analysis,
    );
  }

  return buildDocument('单用户聊天记录表 Single-user Chat Records', children);
}
