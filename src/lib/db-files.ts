import { promises as fs } from 'fs';
import path from 'path';
import { getVolcesSupabaseClient as getSupabaseClient } from '@/lib/supabase-clients';
import { config } from './config';
import { safeRelIn } from './file-utils';
import { tableName } from '@/storage/database/table-names';

interface KbFileRow {
  name: string;
  zone: string;
  content_type?: string | null;
  size: number;
  content?: string;
  format?: string | null;
  status?: string | null;
  updated_at?: string;
}

/**
 * 数据库持久化文件层。
 * 作用：把知识库正式库（active）的文件内容持久化到 Supabase Postgres（kb_files 表），
 * 解决生产环境 /tmp 目录在重新部署/实例重启被清空导致文件丢失的问题。
 * 后端使用 service_role_key（绕过 RLS），操作不受权限限制。
 */

/** 读取数据库里指定区（默认 active）的全部文件记录（不含二进制，仅元数据）。 */
export async function dbListFiles(zone = 'active'): Promise<KbFileRow[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(tableName('kb_files'))
    .select('name, zone, content_type, size, format, status, updated_at')
    .eq('zone', zone)
    .order('name', { ascending: true });
  if (error) throw new Error(`数据库查询文件列表失败: ${error.message}`);
  return (data ?? []) as KbFileRow[];
}

/** 读取某文件内容（二进制 Buffer）。 */
export async function dbGetFileContent(
  name: string,
  zone = 'active',
): Promise<{ content?: Buffer; row: { content_type?: string | null; size: number } | null }> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(tableName('kb_files'))
    .select('content, content_type, size')
    .eq('name', name)
    .eq('zone', zone)
    .maybeSingle();
  if (error) throw new Error(`数据库读取文件内容失败: ${error.message}`);
  if (!data) return { content: undefined, row: null };
  const type = data.content_type as string | null;
  const size = data.size as number;
  const content = data.content as string | null;
  return {
    content: typeof content === 'string' ? Buffer.from(content, 'base64') : undefined,
    row: { content_type: type, size },
  };
}

/**
 * 用数据库中保存的上一版正式库内容覆盖本地文件。
 * 用于「修改」状态下的还原：数据库在再次同步前仍保留知识库当前版本。
 */
export async function restoreActiveFileFromDatabase(name: string): Promise<{
  filename: string;
  size: number;
  mtimeMs: number;
  contentType: string | null;
}> {
  const filename = path.basename(name.trim());
  if (!filename) throw new Error('缺少文件名，无法还原');
  const { content, row } = await dbGetFileContent(filename, 'active');
  if (!content || !row) {
    throw new Error('数据库中没有该文件的已入库版本，无法还原');
  }

  const target = safeRelIn(config.activeRoot, filename);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.restore-tmp`;
  await fs.writeFile(temp, content);
  try {
    await fs.rename(temp, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'EPERM') {
      await fs.rm(target, { force: true });
      await fs.rename(temp, target);
    } else {
      await fs.rm(temp, { force: true });
      throw error;
    }
  }

  const stat = await fs.stat(target);
  return {
    filename,
    size: content.length,
    mtimeMs: stat.mtimeMs,
    contentType: row.content_type ?? null,
  };
}

/** 写入（覆盖）一个文件到数据库。存在同名则覆盖。 */
export async function dbPutFile(
  name: string,
  content: Buffer,
  opts: { zone?: string; contentType?: string | null; format?: string | null; status?: string } = {},
): Promise<void> {
  const zone = opts.zone ?? 'active';
  const client = getSupabaseClient();
  const payload: Record<string, unknown> = {
    name,
    zone,
    content: content.toString('base64'),
    content_type: opts.contentType ?? null,
    size: content.length,
    format: opts.format ?? inferFormat(name),
    status: opts.status ?? 'local',
  };
  // 存在性检查（避免整库覆盖）
  const { data: existing } = await client
    .from(tableName('kb_files'))
    .select('id')
    .eq('name', name)
    .eq('zone', zone)
    .maybeSingle();
  let result: { error: { message: string } | null };
  if (existing) {
    result = await client
      .from(tableName('kb_files'))
      .update(payload)
      .eq('id', (existing as { id: string }).id);
  } else {
    result = await client.from(tableName('kb_files')).insert(payload);
  }
  if (result.error) throw new Error(`数据库写入文件失败: ${result.error.message}`);
}

/** 根据文件名推断展示格式（docx/pdf/xlsx/txt/其他）。 */
export function inferFormat(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx < 0) return 'FILE';
  return name.slice(idx + 1).toUpperCase();
}

/** 更新数据库中某文件的同步状态（local/modified/synced）。 */
export async function dbUpdateStatus(
  name: string,
  status: 'local' | 'modified' | 'synced',
  zone = 'active',
): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client
    .from(tableName('kb_files'))
    .update({ status })
    .eq('name', name)
    .eq('zone', zone);
  if (error) throw new Error(`数据库更新文件状态失败: ${error.message}`);
}

/** 把某文件从暂存区迁移到正式区（确认入库）。正式区已有同名则覆盖；删除暂存区记录。 */
export async function dbMoveToActive(
  name: string,
  opts: { contentType?: string | null } = {},
): Promise<void> {
  // 1) 读取暂存区的记录（含内容）
  const { content, row } = await dbGetFileContent(name, 'staging');
  if (!content || !row) return; // 暂存区无该记录则忽略（可能本就直接入正式区）
  // 2) 写入正式区（覆盖）
  await dbPutFile(name, content, { zone: 'active', contentType: opts.contentType ?? row.content_type });
  // 3) 删除暂存区记录
  await dbDeleteFile(name, 'staging');
}

/** 删除数据库中某文件记录。 */
export async function dbDeleteFile(name: string, zone = 'active'): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client
    .from(tableName('kb_files'))
    .delete()
    .eq('name', name)
    .eq('zone', zone);
  if (error) throw new Error(`数据库删除文件失败: ${error.message}`);
}
