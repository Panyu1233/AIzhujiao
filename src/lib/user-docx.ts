import {
  AlignmentType,
  BorderStyle,
  Document,
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
import { USER_INFO_FIELDS } from './user-info-schema';

type JsonRecord = Record<string, unknown>;

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const TABLE_WIDTH = 15000;
const COLUMN_WIDTHS = [620, 850, 3120, 2280, 6430, 1700] as const;
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'A6A6A6' } as const;
const HEADER_FILL = '2F5597';
const TABLE_BORDERS = {
  top: CELL_BORDER,
  bottom: CELL_BORDER,
  left: CELL_BORDER,
  right: CELL_BORDER,
  insideHorizontal: CELL_BORDER,
  insideVertical: CELL_BORDER,
};

interface FormalFieldRow {
  level: number;
  field: string;
  meaning: string;
  content: string;
  dataType: string;
}

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

function safePart(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');
  return cleaned.slice(0, 80) || fallback;
}

/** 从外部用户数据中提取手机号，兼容常见字段名和嵌套结构。 */
export function userPhoneOf(row: JsonRecord): string {
  const directKeys = ['phone', 'mobile', 'phoneNumber', 'mobilePhone', 'phone_snapshot'];
  for (const key of directKeys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  for (const key of ['basic', 'user', 'customer', 'profile', 'contact']) {
    const nested = row[key];
    if (isRecord(nested)) {
      const phone = userPhoneOf(nested);
      if (phone) return phone;
    }
  }
  return '';
}

/** 优先取昵称，其次取真实姓名。 */
export function userDisplayNameOf(row: JsonRecord): string {
  const directKeys = ['nick_name', 'nickName', 'nickname', 'real_name', 'realName', 'name'];
  for (const key of directKeys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  for (const key of ['basic', 'user', 'customer', 'profile', 'contact']) {
    const nested = row[key];
    if (isRecord(nested)) {
      const name = userDisplayNameOf(nested);
      if (name) return name;
    }
  }
  return '';
}

/** 文件名为：昵称_手机号.docx；同一手机号更新时覆盖同一文件。 */
export function userDocxFilename(row: JsonRecord, source: UserDataSource): string {
  void source;
  const nickname = userDisplayNameOf(row);
  const phone = userPhoneOf(row);
  return `${safePart(nickname, '未命名用户')}_${safePart(phone, '未识别手机号')}.docx`;
}

const EXACT_MEANINGS: Record<string, string> = {
  basic: '基本信息',
  'basic.avatar_url': '头像地址',
  'basic.birthday': '生日',
  'basic.created_at': '创建时间',
  'basic.enrollment_status': '入组/登记状态',
  'basic.gene_status': '基因绑定状态',
  'basic.last_measured_at': '最近测量时间',
  'basic.location': '所在地',
  'basic.name': '姓名',
  'basic.nickname': '昵称',
  'basic.phone': '手机号',
  current_gene_test: '当前基因检测',
  'current_gene_test.bound_at': '绑定时间',
  'current_gene_test.code': '编码/检测码',
  'current_gene_test.id': '唯一标识/ID',
  'current_gene_test.status': '状态',
  gene_tests: '基因检测列表',
  id: '用户记录ID/用户ID',
  sensitive_data_mode: '敏感数据模式',
  updated_at: '更新时间',
};

const LEAF_MEANINGS: Record<string, string> = {
  avatar_url: '头像地址',
  birthday: '生日',
  created_at: '创建时间',
  enrollment_status: '入组/登记状态',
  gene_status: '基因绑定状态',
  last_measured_at: '最近测量时间',
  location: '所在地',
  name: '姓名',
  nickname: '昵称',
  phone: '手机号',
  bound_at: '绑定时间',
  code: '编码/检测码',
  id: '唯一标识/ID',
  status: '状态',
  source_type: '来源类型',
  source_detail: '来源明细',
  source_code: '来源编码',
  group_name: '群名称',
  current_stage: '当前阶段',
  real_name: '真实姓名',
  nick_name: '昵称',
  phone_mask: '脱敏手机号',
  phone_verified: '手机号是否验证',
  phone_source: '手机号来源',
  phone_authorized: '手机号是否授权',
  is_authorized: '是否完成微信授权',
  age: '年龄',
  gender: '性别',
  tags: '用户标签',
  profile: '用户原始档案',
  remark: '备注',
  privacy_consent: '隐私授权',
  consent_time: '授权时间',
  first_seen_at: '首次出现时间',
  last_active_at: '最后活跃时间',
  merge_status: '合并状态',
  wechat_profile_updated_at: '微信档案更新时间',
  enroll_status: '入组状态',
  enroll_time: '入组时间',
  gene_bind_status: '基因绑定状态',
  gene_phone: '绑定人手机号',
  gene_sample_id: '基因样本编号',
  gene_bindings_raw: '基因绑定原始数据',
  height_cm: '身高（厘米）',
  health_weight_kg: '体重（千克）',
  heart_rate: '心率',
  health_goal: '健康目标',
  health_risk_tags: '健康风险标签',
  progress_raw: '进度原始数据',
  progress_updated_at: '进度更新时间',
  report_images_raw: '报告图片原始数据',
};

const SCHEMA_MEANINGS = new Map(
  USER_INFO_FIELDS.map((field) => {
    const firstClause = (field.desc ?? '')
      .split(/[，,；;]/)
      .map((part) => part.trim())
      .find(Boolean);
    return [field.name, firstClause || field.name] as const;
  }),
);

function lastFieldKey(path: string): string {
  const last = path.split('.').pop() ?? path;
  return last.replace(/\[\d+\]$/g, '');
}

function meaningFor(path: string): string {
  const normalized = path.replace(/\[\d+\]/g, '');
  if (EXACT_MEANINGS[normalized]) return EXACT_MEANINGS[normalized];
  const key = lastFieldKey(path);
  if (LEAF_MEANINGS[key]) return LEAF_MEANINGS[key];
  if (normalized === 'id') return '用户记录ID/用户ID';
  return SCHEMA_MEANINGS.get(key) ?? key;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const ENUM_KEYS = new Set([
  'status',
  'enrollment_status',
  'gene_status',
  'sensitive_data_mode',
  'source_type',
  'merge_status',
  'enroll_status',
  'gene_bind_status',
  'gender',
]);

const DATETIME_KEYS = new Set([
  'created_at',
  'updated_at',
  'last_measured_at',
  'bound_at',
  'consent_time',
  'first_seen_at',
  'last_active_at',
  'wechat_profile_updated_at',
  'enroll_time',
  'health_survey_time',
  'health_data_updated_at',
  'progress_updated_at',
  'memory_updated_at',
  'last_synced_at',
]);

function expectedTypeFor(key: string): string {
  if (key === 'birthday') return 'date';
  if (DATETIME_KEYS.has(key) || key.endsWith('_at')) return 'datetime';
  if (key === 'id' || key.endsWith('_id')) return 'string（UUID）';
  if (ENUM_KEYS.has(key) || key.endsWith('_status') || key === 'gender') return 'string（枚举）';
  return 'null';
}

function dataTypeFor(value: unknown, path: string): string {
  const key = lastFieldKey(path);
  if (value === null) return expectedTypeFor(key);
  if (Array.isArray(value)) return 'array';
  if (isRecord(value)) return 'object';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value !== 'string') return typeof value;

  const text = value.trim();
  if (!text) return 'string';
  if (/^(https?:\/\/|\/api\/)/i.test(text)) return 'string（URL 路径）';
  if (UUID_PATTERN.test(text)) return 'string（UUID）';
  if (DATETIME_PATTERN.test(text)) return 'datetime';
  if (DATE_PATTERN.test(text)) return 'date';
  if (ENUM_KEYS.has(key)) return 'string（枚举）';
  return 'string';
}

function contentFor(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `数组，共 ${value.length} 项`;
  if (isRecord(value)) return '对象（见下方各字段）';
  return textValue(value) || 'null';
}

function flattenFields(value: unknown): FormalFieldRow[] {
  const rows: FormalFieldRow[] = [];

  const visit = (path: string, current: unknown, level: number) => {
    if (Array.isArray(current)) {
      rows.push({
        level,
        field: path,
        meaning: meaningFor(path),
        content: `数组，共 ${current.length} 项`,
        dataType: 'array',
      });
      current.forEach((item, index) => {
        if (isRecord(item)) {
          for (const [key, child] of Object.entries(item)) {
            visit(`${path}[${index}].${key}`, child, level + 1);
          }
        } else {
          visit(`${path}[${index}]`, item, level + 1);
        }
      });
      return;
    }

    if (isRecord(current)) {
      rows.push({
        level,
        field: path,
        meaning: meaningFor(path),
        content: '对象（见下方各字段）',
        dataType: 'object',
      });
      for (const [key, child] of Object.entries(current)) {
        visit(`${path}.${key}`, child, level + 1);
      }
      return;
    }

    rows.push({
      level,
      field: path,
      meaning: meaningFor(path),
      content: contentFor(current),
      dataType: dataTypeFor(current, path),
    });
  };

  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) visit(key, child, 1);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (isRecord(item)) {
        for (const [key, child] of Object.entries(item)) visit(`[${index}].${key}`, child, 1);
      }
    });
  }
  return rows;
}

function formalRoot(value: unknown): unknown {
  if (isRecord(value) && isRecord(value.profile) && isRecord(value.profile.basic)) {
    return value.profile;
  }
  return value;
}

const BODY_FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Calibri', cs: 'Calibri' };
const HEADER_FONT = { ascii: '等线', hAnsi: '等线', eastAsia: '等线', cs: '等线' };

function cellParagraph(text: string, options: { header?: boolean; align?: 'left' | 'center' } = {}): Paragraph {
  return new Paragraph({
    alignment: options.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: 0, after: 0, line: 240 },
    children: [
      new TextRun({
        text: text || '—',
        font: options.header ? HEADER_FONT : BODY_FONT,
        size: options.header ? 22 : 22,
        bold: options.header,
        color: options.header ? 'FFFFFF' : '000000',
      }),
    ],
  });
}

function formalCell(
  text: string,
  width: number,
  opts: { header?: boolean; align?: 'left' | 'center'; fill?: string } = {},
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlignTable.CENTER,
    shading: opts.fill ? { fill: opts.fill, color: 'auto' } : undefined,
    margins: { top: 45, bottom: 45, left: 100, right: 100 },
    children: [cellParagraph(text, { header: opts.header, align: opts.align })],
  });
}

/** 生成与用户字段模板一致的六列 DOCX：序号、层级、原字段、中文含义、原始值、数据类型。 */
export async function buildFormalUserDocx(value: unknown, source: UserDataSource): Promise<Buffer> {
  void source;
  const fields = flattenFields(formalRoot(value));
  const headers = ['序号', '层级', '字段（原字段）', '中文含义', '内容（原始值）', '数据类型'];
  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    height: { value: 420, rule: HeightRule.ATLEAST },
    children: headers.map((header, index) =>
      formalCell(header, COLUMN_WIDTHS[index], {
        header: true,
        align: 'center',
        fill: HEADER_FILL,
      }),
    ),
  });

  const bodyRows = fields.map((field, index) =>
    new TableRow({
      cantSplit: false,
      height: { value: 400, rule: HeightRule.ATLEAST },
      children: [
        formalCell(String(index + 1), COLUMN_WIDTHS[0], { align: 'center' }),
        formalCell(String(field.level), COLUMN_WIDTHS[1], { align: 'center' }),
        formalCell(field.field, COLUMN_WIDTHS[2]),
        formalCell(field.meaning, COLUMN_WIDTHS[3]),
        formalCell(field.content, COLUMN_WIDTHS[4]),
        formalCell(field.dataType, COLUMN_WIDTHS[5], { align: 'center' }),
      ],
    }),
  );

  const table = new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: [...COLUMN_WIDTHS],
    layout: TableLayoutType.FIXED,
    borders: TABLE_BORDERS,
    alignment: AlignmentType.CENTER,
    margins: { top: 40, bottom: 40, left: 100, right: 100 },
  });

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 22 },
          paragraph: { spacing: { before: 0, after: 0, line: 240 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children: [table],
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

/** 拉取外部 API 时也先生成字段模板，解析后会按正式模板再刷新一次。 */
export async function buildUserDocx(row: JsonRecord, source: UserDataSource): Promise<Buffer> {
  return buildFormalUserDocx(row, source);
}




