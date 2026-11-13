import { promises as fs } from 'fs';
import path from 'path';
import { config } from '@/lib/config';
import { ApiError, badRequest, configError } from '@/lib/errors';
import { getAlzhujiaoSupabaseClient, isSupabaseInstanceConfigured } from '@/lib/supabase-clients';
import { tableName } from '@/storage/database/table-names';
import { listChatRecords, type ChatRecordResult } from '@/lib/chat-records';

type Row = Record<string, unknown>;

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LocalKnowledgeFile {
  id: string;
  name: string;
  path: string;
  zone: 'active';
  format: string;
  size: number;
  createTime: string;
  updateTime: string;
}

export interface LocalKnowledgeFileFilters {
  keyword?: string;
  format?: string;
  page?: number;
  pageSize?: number;
}

export interface UserListFilters {
  phone?: string;
  keyword?: string;
  calibrationStatus?: string;
  page?: number;
  pageSize?: number;
}

export interface UserListResult extends PageResult<Row> {
  table: 'user_info_agent' | 'user_info';
  source: 'supabase';
}

export type ChatMessageListResult = ChatRecordResult;

const DEFAULT_IGNORE_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.git',
  'node_modules',
  '__MACOSX',
]);

const USER_CALIBRATION_STATUSES = new Set(['success', 'failed', 'pending']);

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const numeric = Number.isFinite(value) ? Number(value) : fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

export function pageParams(filters: { page?: number; pageSize?: number }): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const page = clampInt(filters.page, 1, 1, 100000);
  const pageSize = clampInt(filters.pageSize, 20, 1, 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function optionalQueryText(value: string | null): string | undefined {
  return optionalText(value);
}

export function optionalQueryInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferFormat(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return 'FILE';
  return name.slice(dot + 1).toUpperCase();
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function isIgnoredName(name: string): boolean {
  if (DEFAULT_IGNORE_NAMES.has(name) || config.ignoreNames.has(name)) return true;
  if (!config.includeHidden && name.startsWith('.')) return true;
  return false;
}

async function walkFiles(
  dir: string,
  relativeDir = '',
  output: LocalKnowledgeFile[] = [],
): Promise<LocalKnowledgeFile[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return output;
    throw error;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

  for (const entry of entries) {
    if (isIgnoredName(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

    let stat;
    try {
      stat = await fs.lstat(absolute);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;

    if (stat.isDirectory()) {
      await walkFiles(absolute, relative, output);
      continue;
    }
    if (!stat.isFile()) continue;

    const rel = toPosix(relative);
    output.push({
      id: rel,
      name: entry.name,
      path: rel,
      zone: 'active',
      format: inferFormat(entry.name),
      size: stat.size,
      createTime: new Date(stat.birthtimeMs || stat.ctimeMs).toISOString(),
      updateTime: new Date(stat.mtimeMs).toISOString(),
    });
  }

  return output;
}

/** 列出本地正式库 active 区的全部文件，不包含 staging。 */
export async function listLocalKnowledgeFiles(
  filters: LocalKnowledgeFileFilters,
): Promise<PageResult<LocalKnowledgeFile>> {
  const keyword = optionalText(filters.keyword)?.toLowerCase();
  const format = optionalText(filters.format)?.toUpperCase();
  const { page, pageSize, offset } = pageParams(filters);

  const all = await walkFiles(config.activeRoot);
  const matched = all
    .filter((file) => !keyword || file.path.toLowerCase().includes(keyword) || file.name.toLowerCase().includes(keyword))
    .filter((file) => !format || file.format === format)
    .sort((a, b) => b.updateTime.localeCompare(a.updateTime) || a.path.localeCompare(b.path, 'zh-Hans-CN'));

  return {
    items: matched.slice(offset, offset + pageSize),
    total: matched.length,
    page,
    pageSize,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function postgrestKeyword(value: string): string {
  // 避免把用户输入中的分隔符解释成 PostgREST or() 语法。
  return value.replace(/[\\,()%_]/g, ' ').trim();
}

function ensureUserDatabase(): void {
  if (!isSupabaseInstanceConfigured('alzhujiao')) {
    throw configError('用户数据库未配置：请设置 ALZHUJIAO_SUPABASE_URL 和 ALZHUJIAO_SUPABASE_KEY');
  }
}

function validateCalibrationStatus(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!USER_CALIBRATION_STATUSES.has(value)) {
    throw badRequest('calibrationStatus 只能是 success、failed 或 pending');
  }
  return value;
}

function databaseError(table: string, error: unknown): ApiError {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message || '数据库连接失败')
      : '数据库连接失败';
  return new ApiError(503, 'DATABASE_UNAVAILABLE', `查询 ${table} 失败：${message}`);
}

async function listUsers(
  baseTable: 'user_info_agent' | 'user_info',
  filters: UserListFilters,
  forcedEq: Record<string, string> = {},
): Promise<UserListResult> {
  ensureUserDatabase();
  const client = getAlzhujiaoSupabaseClient();
  const { page, pageSize, offset } = pageParams(filters);
  const phone = optionalText(filters.phone);
  const keyword = optionalText(filters.keyword);
  const calibrationStatus = validateCalibrationStatus(optionalText(filters.calibrationStatus));

  let query = client
    .from(tableName(baseTable))
    .select('*', { count: 'exact' });

  for (const [column, value] of Object.entries(forcedEq)) {
    query = query.eq(column, value);
  }
  if (phone) query = query.ilike('phone', `%${escapeLike(phone)}%`);
  if (calibrationStatus) query = query.eq('calibration_status', calibrationStatus);

  if (keyword) {
    const term = postgrestKeyword(keyword);
    if (term) {
      const pattern = `%${escapeLike(term)}%`;
      query = query.or(`phone.ilike.${pattern},nick_name.ilike.${pattern},real_name.ilike.${pattern}`);
    }
  }

  let result;
  try {
    result = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
  } catch (error) {
    throw databaseError(baseTable, error);
  }

  if (result.error) throw databaseError(baseTable, result.error);

  return {
    items: (result.data ?? []) as unknown as Row[],
    total: result.count ?? 0,
    page,
    pageSize,
    table: baseTable,
    source: 'supabase',
  };
}

/** 智能体原始用户信息表（user_info_agent）。 */
export async function listAgentUsers(filters: UserListFilters): Promise<UserListResult> {
  return listUsers('user_info_agent', filters);
}

/** 手机号校准后的统一用户信息表（user_info，仅 source_type=calibrated）。 */
export async function listCalibratedUsers(filters: UserListFilters): Promise<UserListResult> {
  return listUsers('user_info', filters, { source_type: 'calibrated' });
}

/** 用户聊天记录，复用现有手机号关联校准用户的查询逻辑。 */
export async function listChatMessages(filters: {
  phone?: string;
  keyword?: string;
  direction?: string;
  msgType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}): Promise<ChatMessageListResult> {
  ensureUserDatabase();
  try {
    return await listChatRecords(filters);
  } catch (error) {
    throw new ApiError(
      503,
      'DATABASE_UNAVAILABLE',
      error instanceof Error ? error.message : '查询用户聊天记录失败',
    );
  }
}

