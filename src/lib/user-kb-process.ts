/**
 * 用户信息「解析 / 存入」加工逻辑。
 *
 * 流程：
 *  - 解析（parse）：用 DS 模型把上传的 docx 内容解析为结构化用户信息数据（对照表格模板），
 *    结果以 JSON 文本存回本地用户信息记录，状态置为 parsed（正式库待上传）。
 *  - 上传数据库（commit）：把解析结果写入共享库 Supabase 的 user_info 表，状态置为 committed（已上传数据库）。
 *
 * 依赖的外部配置（部署面板 / .env.local 配置后即激活，缺失时给出明确提示）：
 *  - DS_API_KEY / DS_BASE_URL / DS_MODEL      : DeepSeek 模型 API
 *  - SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY : Supabase 连接
 *  - SHARE_TABLE_NAME : 共享库中存放用户信息数据的表名（默认 user_info）
 *
 * 注意：本模块不连接火山知识库（用户信息与火山完全无关）。
 */
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import { config } from './config';
import { getAlzhujiaoSupabaseClient as getSupabaseClient } from '@/lib/supabase-clients';
import { tableName } from '@/storage/database/table-names';
import {
  userKbGetFile,
  userKbGetParsed,
  userKbGetSourcePayload,
  userKbReplaceContent,
  type UserDataSource,
} from './user-kb-files';
import { DOCX_MIME, buildFormalUserDocx } from './user-docx';
import { USER_INFO_FIELDS, USER_INFO_HEADERS } from './user-info-schema';
import { extractGulesiProfiles, gulesiProfileToUserInfo } from './gulesi-api';

/** 从 docx 二进制 Buffer 提取纯文本。 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return (result.value ?? '').trim();
}

/** 判断 DS 模型解析是否已配置（火山方舟 ARK 优先，其次官方 DeepSeek）。 */
export function isDsConfigured(): boolean {
  return Boolean(config.arkApiKey || config.dsApiKey);
}

/** 当前生效的模型来源描述：ark（火山方舟）或 deepseek（官方）。 */
export function getDsProvider(): 'ark' | 'deepseek' {
  return Boolean(config.arkApiKey) ? 'ark' : 'deepseek';
}

/** 解析用的模型 baseURL / key / model（按 provider 归一化，便于调用方统一请求）。 */
export function getDsEndpoint(): { baseUrl: string; apiKey: string; model: string } {
  if (config.arkApiKey) {
    return { baseUrl: config.arkBaseUrl, apiKey: config.arkApiKey, model: config.arkModel };
  }
  return { baseUrl: config.dsBaseUrl, apiKey: config.dsApiKey, model: config.dsModel };
}

/** 判断共享库 Supabase 是否已配置（支持 publishable / secret 两种 key）。 */
export function isShareConfigured(): boolean {
  return Boolean(
    config.shareSupabaseUrl &&
      (config.shareSupabaseKey || config.shareSupabaseSecretKey),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 兼容外部 API 常见的 { data: [] } / { items: [] } 包装。 */
export function extractUserInfoRows(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed.filter(isRecord);
  if (!isRecord(parsed)) return [];
  for (const key of ['items', 'records', 'rows', 'list', 'data']) {
    const value = parsed[key];
    if (Array.isArray(value)) return value.filter(isRecord);
    if (isRecord(value)) {
      for (const nestedKey of ['items', 'records', 'rows', 'list', 'data']) {
        const nested = value[nestedKey];
        if (Array.isArray(nested)) return nested.filter(isRecord);
      }
    }
  }
  return [parsed];
}

/**
 * 生成「用户信息表 user_info」的字段模板说明（对照《知识库四表字段定义》表4）。
 * 让 DS 按此清单输出结构化用户信息，字段与数据库 user_info 表完全一致。
 */
function buildUserInfoTemplateHint(): string {
  const parts = USER_INFO_FIELDS.map((f) => {
    const meta = [f.type, f.required ? `必填:${f.required}` : '', f.desc].filter(Boolean).join(' | ');
    return `- ${f.name}${meta ? `（${meta}）` : ''}`;
  });
  return (
    '字段清单如下（严格使用这些字段名作为 JSON 键；文档中缺失或无法确定的字段填 null 或省略。仅保留用户信息表字段，不要额外发明字段）：\n' +
    parts.join('\n')
  );
}

interface ParseOptions {
  /** 提示给模型的“表格模板”说明（列定义等），用于让 DS 按模板生成结构化数据。 */
  templateHint?: string;
}

export interface DsJsonOptions {
  maxTokens?: number;
  temperature?: number;
}

function parseDsJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const candidates = [stripped];
  const objectStart = stripped.indexOf('{');
  const arrayStart = stripped.indexOf('[');
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (starts.length > 0) {
    const first = Math.min(...starts);
    const objectEnd = stripped.lastIndexOf('}');
    const arrayEnd = stripped.lastIndexOf(']');
    const last = Math.max(objectEnd, arrayEnd);
    if (last > first) candidates.push(stripped.slice(first, last + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 继续尝试下一个候选片段。
    }
  }
  throw new Error('DS 模型返回的内容不是合法 JSON，请检查解析结果');
}

/** 调用已配置的 ARK / DeepSeek 模型，返回严格 JSON。 */
export async function callDsJson(
  systemPrompt: string,
  userContent: string,
  opts: DsJsonOptions = {},
): Promise<unknown> {
  if (!isDsConfigured()) {
    throw new Error(
      'DS 模型 API 未配置：请在部署面板配置 ARK_API_KEY（火山方舟）或 DS_API_KEY（官方 DeepSeek）',
    );
  }
  if (!userContent.trim()) throw new Error('待解析内容为空');

  const ep = getDsEndpoint();
  const isArk = getDsProvider() === 'ark';
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${ep.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ep.apiKey}`,
        },
        body: JSON.stringify({
          model: ep.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          ...(isArk
            ? {}
            : {
                temperature: opts.temperature ?? 0,
                response_format: { type: 'json_object' } as const,
              }),
          max_tokens: opts.maxTokens ?? 8000,
          stream: false,
        }),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
        lastError = new Error(`DS 模型调用失败（${response.status}）：${errText.slice(0, 300)}`);
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        continue;
      }
      throw new Error(`DS 模型调用失败（${response.status}）：${errText.slice(0, 300)}`);
    }

    let payload: { choices?: { message?: { content?: string } }[] };
    try {
      payload = (await response.json()) as typeof payload;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        continue;
      }
      break;
    }

    const content = payload.choices?.[0]?.message?.content ?? '';
    if (content.trim()) {
      try {
        return parseDsJsonContent(content);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    } else {
      lastError = new Error('DS 模型返回内容为空');
    }

    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }

  throw new Error(
    `DS 模型连续 3 次未返回可解析 JSON：${lastError?.message ?? '未知原因'}`,
  );
}

/**
 * 调用 DS 模型解析 docx 内容。
 * 返回解析后的结构化数据（未知结构，由模型按表格模板决定；通常是 JSON 对象或数组）。
 */
export async function parseWithDS(docxBuffer: Buffer, opts: ParseOptions = {}): Promise<unknown> {
  const text = await extractDocxText(docxBuffer);
  if (!text) throw new Error('docx 内容为空，无法解析');
  const templateHint = opts.templateHint ?? buildUserInfoTemplateHint();
  return callDsJson(
    `你是数据解析助手。请把用户文档内容解析为结构化数据，严格对照如下信息字段模板：${templateHint}。只返回合法 JSON 对象，不要包含解释性文字。`,
    text,
  );
}
/**
 * 把解析结果写入对应来源表：
 * - 小程序用户 -> user_info_mini
 * - 智能体用户 -> user_info_agent
 * 以手机号为唯一键 upsert，等待校准后写入 user_info。
 */
export interface CommitResult {
  table: string;
  inserted: unknown[];
}

const SOURCE_TABLE: Record<Exclude<UserDataSource, 'unidentified_agent_user'>, string> = {
  gulesi_mini_program: tableName('user_info_mini'),
  agent_api: tableName('user_info_agent'),
};

function normalizeSourceRow(
  row: Record<string, unknown>,
  index: number,
  source: UserDataSource,
): Record<string, unknown> {
  const phone = String(row.phone ?? '').trim();
  if (!phone) throw new Error(`第 ${index + 1} 条数据缺少手机号，无法写入来源表`);

  const genderValue = Number(row.gender);
  const statusValue = Number(row.status);
  const normalized: Record<string, unknown> = {
    phone,
    nick_name: String(row.nick_name ?? '').trim() || phone,
    real_name: row.real_name ?? null,
    avatar_url: row.avatar_url ?? null,
    openid: row.openid ?? null,
    unionid: row.unionid ?? null,
    gender: Number.isFinite(genderValue) ? Math.trunc(genderValue) : 0,
    birthday: row.birthday ?? null,
    location: row.location ?? null,
    source_detail:
      String(row.source_detail ?? '').trim() ||
      (source === 'gulesi_mini_program' ? '谷乐斯小程序用户数据' : '智能体用户数据'),
    status: Number.isFinite(statusValue) ? Math.trunc(statusValue) : 1,
    raw_data: isRecord(row.profile) ? row.profile : isRecord(row.raw_data) ? row.raw_data : row,
    last_synced_at: new Date().toISOString(),
  };

  if (source === 'gulesi_mini_program') {
    normalized.mini_openid = row.mini_openid ?? null;
    normalized.mp_openid = row.mp_openid ?? null;
  } else {
    normalized.group_openid = row.group_openid ?? null;
  }
  return normalized;
}

export async function commitUserInfo(data: unknown, source: UserDataSource): Promise<CommitResult> {
  if (source === 'unidentified_agent_user') {
    throw new Error('未标识的智能体用户目前只做本地 DS 解析，尚未建立 Supabase 字段映射，暂不能上传');
  }
  if (!isShareConfigured()) {
    throw new Error(
      'Alzhujiao Supabase 未配置：请配置 ALZHUJIAO_SUPABASE_URL / ALZHUJIAO_SUPABASE_KEY',
    );
  }
  const table = SOURCE_TABLE[source];
  if (!table) throw new Error('未知的用户信息数据源');

  const client = getSupabaseClient();
  const rows = extractUserInfoRows(data).map((row, index) => normalizeSourceRow(row, index, source));
  if (rows.length === 0) throw new Error('没有可写入的用户信息');

  const inserted: unknown[] = [];
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { data: insertedRows, error } = await client
      .from(table)
      .upsert(batch, { onConflict: 'phone' })
      .select();
    if (error) throw new Error(`写入${table}失败：${error.message}`);
    if (Array.isArray(insertedRows)) inserted.push(...insertedRows);
  }
  return { table, inserted } satisfies CommitResult;
}

/** 删除已上传数据库的用户信息文件对应的远端用户记录。 */
export async function deleteCommittedUserInfoFile(name: string): Promise<{
  remoteDeleted: boolean;
  table?: string;
  deleted: number;
}> {
  const detail = await userKbGetFile(name);
  if (!detail) throw new Error('用户信息文件不存在');
  if (detail.status !== 'committed') {
    return { remoteDeleted: false, deleted: 0 };
  }

  const parsed = await userKbGetParsed(name);
  if (parsed === null || parsed === undefined) {
    throw new Error('文件已标记为已上传，但找不到解析结果，无法删除数据库记录');
  }
  const source: UserDataSource = detail.data_source === 'agent_api'
    ? 'agent_api'
    : detail.data_source === 'unidentified_agent_user'
      ? 'unidentified_agent_user'
      : 'gulesi_mini_program';
  if (source === 'unidentified_agent_user') {
    throw new Error('未标识的智能体用户尚未建立 Supabase 删除映射，不能删除远端记录');
  }
  const table = SOURCE_TABLE[source];
  const rows = extractUserInfoRows(parsed).map((row, index) => normalizeSourceRow(row, index, source));
  const phones = [...new Set(rows.map((row) => String(row.phone || '').trim()).filter(Boolean))];
  if (phones.length === 0) {
    throw new Error('解析结果中没有手机号，无法定位要删除的数据库记录');
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(table)
    .delete()
    .in('phone', phones)
    .select('id');
  if (error) throw new Error(`删除 ${table} 中的用户记录失败：${error.message}`);
  return { remoteDeleted: true, table, deleted: Array.isArray(data) ? data.length : phones.length };
}

/** 读取暂存文件并解析：JSON 直接结构化；其他文档交给 DS 模型。 */
export async function parseUserKbFile(name: string): Promise<{ parsed: unknown; text: string }> {
  const detail = await userKbGetFile(name);
  if (!detail || !detail.content) throw new Error('文件不存在或内容为空');

  if (/\.json$/i.test(name) || (detail.content_type || '').includes('json')) {
    const text = detail.content.toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('JSON 文件格式不合法');
    }
    const gulesiProfiles = extractGulesiProfiles(parsed);
    if (gulesiProfiles.length > 0) {
      const rows = gulesiProfiles.map(gulesiProfileToUserInfo);
      if (rows.some((row) => !String(row.phone ?? '').trim())) {
        throw new Error('谷乐斯数据缺少手机号，无法按手机号进入正式库');
      }
      return { parsed: rows, text };
    }
    const rows = extractUserInfoRows(parsed);
    if (rows.length === 0) throw new Error('JSON 中没有可用的用户信息记录');
    return { parsed: rows.length === 1 && !Array.isArray(parsed) ? rows[0] : rows, text };
  }

  const parsed = await parseWithDS(detail.content);
  const text = await extractDocxText(detail.content);
  return { parsed, text };
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 把 DS 解析的结构化用户数据生成 xlsx 表格字节（表头为字段名，值逐行写入）。 */
export async function buildXlsxFromParsed(parsed: unknown): Promise<Buffer> {
  const rows = extractUserInfoRows(parsed);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('用户信息');

  if (rows.length === 0) {
    throw new Error('解析结果为空，无法生成表格');
  }

  // 表头固定为用户信息表 user_info 的字段顺序，保证与数据库结构一致（缺失字段留空）
  const headers = USER_INFO_HEADERS;
  sheet.columns = headers.map((h) => ({
    header: h,
    key: h,
    width: Math.min(40, Math.max(12, h.length * 2 + 6)),
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
  });

  const fillRow = (r: Record<string, unknown>) => {
    const row: Record<string, unknown> = {};
    for (const h of headers) {
      row[h] = r[h] ?? null;
    }
    sheet.addRow(row);
  };
  rows.forEach((r) => fillRow(r as Record<string, unknown>));

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

/**
 * 解析后直接进入用户信息正式库区。
 * 文件仍保持 DOCX 格式，不转换成 XLSX；结构化结果只是随记录保存，供“上传数据库”使用。
 */
export async function parseUserKbFileToFormal(name: string): Promise<{
  parsed: unknown;
  name: string;
  size: number;
}> {
  const detail = await userKbGetFile(name);
  if (!detail || !detail.content) throw new Error('文件不存在');
  if (!/\.docx$/i.test(name)) throw new Error('用户信息文件必须是 DOCX 格式');

  const sourcePayload = await userKbGetSourcePayload(name);
  const parsed = sourcePayload ?? (await parseUserKbFile(name)).parsed;
  const source: UserDataSource = detail.data_source === 'agent_api' ? 'agent_api' : 'gulesi_mini_program';
  const formalDocx = await buildFormalUserDocx(sourcePayload ?? parsed, source);
  let parsedText: string | null = null;
  try {
    parsedText = await extractDocxText(detail.content);
  } catch {
    parsedText = null;
  }

  await userKbReplaceContent(
    name,
    name,
    formalDocx,
    { contentType: DOCX_MIME, format: 'DOCX' },
    { parsedResult: JSON.stringify(parsed), text: parsedText },
  );
  return { parsed, name, size: formalDocx.length };
}

/** 解析后把 xlsx 结果写入用户信息正式库：替换原记录内容与元数据，状态置 parsed。 */
export async function parseUserKbFileToXlsx(name: string): Promise<{
  parsed: unknown;
  xlsxName: string;
  xlsxSize: number;
}> {
  const { parsed, text } = await parseUserKbFile(name);
  const xlsx = await buildXlsxFromParsed(parsed);
  const xlsxName = name.replace(/\.[^.]+$/, '.xlsx');
  const { userKbReplaceContent } = await import('./user-kb-files');
  await userKbReplaceContent(
    name,
    xlsxName,
    xlsx,
    { contentType: XLSX_MIME, format: 'XLSX' },
    { parsedResult: JSON.stringify(parsed), text },
  );
  return { parsed, xlsxName, xlsxSize: xlsx.length };
}
