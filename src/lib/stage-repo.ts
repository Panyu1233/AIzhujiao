/**
 * 暂存区适配层（Staging Adapter）
 *
 * - 上传到暂存区：文件先落在 STAGING_ROOT，不进入文件索引，FastGPT 拉取不到。
 * - 确认入库（commit）：把暂存文件复制到索引区 KNOWLEDGE_BASE_ROOT 并刷新索引，
 *   此时才被 FastGPT / 火山知识库拉取到；原暂存文件保留，可再删除。
 * - 路径安全：复用 adminfs 的 assertSafeRel / assertNoSymlinkAlong 思路，
 *   拒绝 `..`、绝对路径、符号链接逃逸，防止覆盖索引区或系统文件。
 */
import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config';
import { adminBadRequest, adminForbidden, adminNotFound, adminConflict } from './adminfs';
import { getStats, refreshIndex } from './file-repo';

export interface StagingFile {
  name: string;
  size: number;
  updateTime: string;
  /** 暂存区相对路径（默认顶层取文件名本身）。 */
  rel: string;
}

export interface StagingSummary {
  root: string;
  stagedCount: number;
  indexedCount: number;
}

/** 校验相对暂存区根目录的安全相对路径。 */
function assertSafeRel(rel: string): string {
  const trimmed = (rel ?? '').trim().replace(/\\/g, '/');
  if (!trimmed || trimmed === '/' || trimmed === '.') {
    throw adminBadRequest('必须指定一个暂存文件（不能是暂存区根目录）');
  }
  const segments = trimmed.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg === '..' || seg === '.') throw adminForbidden('非法路径段：.. 或 .');
    if (seg.includes('\0')) throw adminBadRequest('路径包含 NUL 字符');
    if (/^[a-zA-Z]:$/.test(seg) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(seg)) {
      throw adminForbidden('路径段疑似盘符或 URL scheme');
    }
    if (seg.includes('\\')) throw adminBadRequest('路径段内不允许含有反斜杠 \\');
  }
  const safeRel = segments.join('/');
  if (safeRel.startsWith('/') || safeRel.includes('..')) {
    throw adminForbidden('路径越界');
  }
  return safeRel;
}

/** 校验目录根不是符号链接（目标已存在时）。 */
async function assertNotSymlink(dir: string): Promise<void> {
  const st = await fs.lstat(dir).catch(() => null);
  if (st && st.isSymbolicLink()) throw adminForbidden('目录是符号链接，拒绝操作');
}

/** 确保暂存区目录存在。 */
export async function ensureStagingRoot(): Promise<string> {
  await assertNotSymlink(config.stagingRoot);
  await fs.mkdir(config.stagingRoot, { recursive: true });
  return config.stagingRoot;
}

async function statOrNull(p: string) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

/** 递归列出暂存区内的全部文件。 */
async function listFilesRecursive(dir: string, relPrefix: string, out: StagingFile[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    const st = await fs.lstat(abs).catch(() => null);
    if (!st) continue;
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      await listFilesRecursive(abs, rel, out);
    } else if (st.isFile()) {
      out.push({ name: e.name, size: st.size, updateTime: new Date(st.mtimeMs).toISOString(), rel });
    }
  }
}

/** 获取暂存区文件列表。 */
export async function listStaging(): Promise<StagingFile[]> {
  await ensureStagingRoot();
  const out: StagingFile[] = [];
  await listFilesRecursive(config.stagingRoot, '', out);
  return out;
}

/** 生成不冲突文件名（在扩展名前加 (2)、(3)...）。 */
async function dedupeName(dir: string, filename: string): Promise<string> {
  const ext = path.extname(filename);
  const base = ext ? filename.slice(0, -ext.length) : filename;
  let candidate = filename;
  let idx = 2;
  while ((await statOrNull(path.join(dir, candidate))) !== null) {
    candidate = ext ? `${base} (${idx})${ext}` : `${base} (${idx})`;
    idx += 1;
  }
  return candidate;
}

/** 上传文件到暂存区。默认同名自动重命名；overwrite=true 才覆盖。 */
export async function uploadToStaging(
  file: File,
  overwrite = false,
): Promise<{ name: string; size: number; overwritten: boolean }> {
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength === 0) throw adminBadRequest('上传文件为空');

  let rawName = file.name.replace(/\\/g, '/').split('/').pop()?.trim() ?? '';
  if (!rawName) rawName = 'unnamed';
  if (
    rawName.includes('\0') ||
    rawName === '.' ||
    rawName === '..' ||
    /^[a-zA-Z]:/.test(rawName)
  ) {
    throw adminBadRequest('文件名包含非法字符');
  }

  const root = await ensureStagingRoot();
  let name = rawName;
  const exists = (await statOrNull(path.join(root, name))) !== null;
  if (exists && !overwrite) {
    name = await dedupeName(root, rawName);
  }
  const abs = path.join(root, name);
  await assertNotSymlink(root);
  await fs.writeFile(abs, buf);
  console.info(`[staging] upload ${name} (${buf.byteLength}B, overwrite=${overwrite})`);
  return { name, size: buf.byteLength, overwritten: exists && overwrite };
}

/**
 * 确认入库：把单个暂存文件复制到索引区根目录并刷新索引。
 * 索引区同名已存在时自动追加 ` (2)` 避免覆盖；原暂存文件保留。
 */
export async function commitStagingFile(
  rel: string,
): Promise<{ rel: string; name: string }> {
  const safeRel = assertSafeRel(rel);
  const stagingAbs = path.join(config.stagingRoot, ...safeRel.split('/'));
  const st = await statOrNull(stagingAbs);
  if (!st || !st.isFile()) throw adminNotFound('暂存文件不存在');

  const name = safeRel.split('/').pop() ?? safeRel;
  const indexRoot = config.knowledgeBaseRoot;
  await assertNotSymlink(indexRoot);
  await fs.mkdir(indexRoot, { recursive: true });

  let targetRel = name;
  if ((await statOrNull(path.join(indexRoot, targetRel))) !== null) {
    targetRel = await dedupeName(indexRoot, name);
  }
  await fs.copyFile(stagingAbs, path.join(indexRoot, targetRel));
  await refreshIndex();
  console.info(`[staging] commit ${safeRel} -> ${targetRel}`);
  return { rel: targetRel, name: targetRel.split('/').pop() ?? targetRel };
}

/** 从暂存区删除文件。 */
export async function removeStagingFile(rel: string): Promise<void> {
  const safeRel = assertSafeRel(rel);
  const abs = path.join(config.stagingRoot, ...safeRel.split('/'));
  const st = await statOrNull(abs);
  if (!st) throw adminNotFound('暂存文件不存在');
  if (st.isDirectory()) throw adminConflict('暂存区仅支持删除文件，不支持删除目录');
  await fs.unlink(abs);
  console.info(`[staging] delete ${safeRel}`);
}

/** 汇总：暂存区文件数 + 索引区（已入库）文件数。 */
export async function getStagingSummary(): Promise<StagingSummary> {
  await ensureStagingRoot();
  const staged = await listStaging();
  let indexedCount = 0;
  try {
    const stats = await getStats();
    indexedCount = stats.fileCount;
  } catch {
    indexedCount = 0;
  }
  return {
    root: config.stagingRoot,
    stagedCount: staged.length,
    indexedCount,
  };
}