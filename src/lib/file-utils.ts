/**
 * 底层文件操作工具（fs/promises 封装）。
 *
 * 采用极简三区结构，全部基于 Node.js fs/promises，无缓存、无仓库层：
 *   - staging：第三方上传待审
 *   - active ：审核通过后 FastGPT 唯一读取目录
 */
import { promises as fs } from 'fs';
import path from 'path';
import { config } from '@/lib/config';
import { ApiError, badRequest, notFound, toApiError } from '@/lib/errors';

/** 确保目录存在，不存在则递归创建。 */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** 初始化三区目录。 */
export async function ensureDirs(): Promise<void> {
  await ensureDir(config.knowledgeBaseRoot);
  await ensureDir(config.stagingRoot);
  await ensureDir(config.activeRoot);
}

/**
 * 路径防逃逸校验：把文件名/相对路径限制在 base 目录内。
 * - 拒绝绝对路径、`..` 穿越、URL scheme、NUL、反斜杠、盘符。
 * - 返回拼接后的绝对路径；非法则抛 400。
 */
export function safeRelIn(base: string, rel: string, kind = '文件名'): string {
  if (typeof rel !== 'string' || rel.trim() === '') {
    throw badRequest(`${kind}不能为空`);
  }
  const candidate = rel.trim();
  if (
    candidate.includes('\0') ||
    candidate.includes('\\') ||
    candidate.startsWith('/') ||
    candidate.startsWith('..') ||
    /^[a-zA-Z]:[\\/]/.test(candidate) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)
  ) {
    throw badRequest(`非法的${kind}：${rel}`);
  }
  const target = path.resolve(base, candidate);
  const baseResolved = path.resolve(base);
  if (target !== baseResolved && !target.startsWith(baseResolved + path.sep)) {
    throw badRequest(`路径越界：${kind}不在 ${baseResolved} 内`);
  }
  return target;
}

/** 列出目录下直接子文件（不递归），返回 { name, size, mtimeMs }。 */
export async function listFiles(
  dir: string,
): Promise<Array<{ name: string; size: number; mtimeMs: number }>> {
  await ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: Array<{ name: string; size: number; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    try {
      const st = await fs.stat(full);
      files.push({ name: entry.name, size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      // 单文件不可达则跳过，不阻塞整体
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return files;
}

/** 移动文件（同文件名则追加 ` (2)`、` (3)`… 避免覆盖）。返回最终目标绝对路径。 */
export async function moveFile(
  fromAbs: string,
  toDir: string,
  filename: string,
): Promise<{ targetAbs: string; finalName: string }> {
  await ensureDir(toDir);
  const base = path.basename(filename);
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let finalName = base;
  let targetAbs = path.join(toDir, finalName);
  let i = 2;
  while (true) {
    try {
      await fs.access(targetAbs);
    } catch {
      break; // 目标不存在，可用
    }
    finalName = `${stem} (${i})${ext}`;
    targetAbs = path.join(toDir, finalName);
    i += 1;
  }
  try {
    await fs.rename(fromAbs, targetAbs);
  } catch (err) {
    // 跨设备 rename 失败时退回 copy+unlink
    try {
      await fs.copyFile(fromAbs, targetAbs);
      await fs.unlink(fromAbs);
    } catch (copyErr) {
      throw toApiError(copyErr);
    }
  }
  return { targetAbs, finalName };
}

/** 移动 staging 文件到 active（审核通过）。返回目标文件名；staging 中不存在则 404。 */
export async function promoteToActive(
  stagingDir: string,
  activeDir: string,
  filename: string,
): Promise<string> {
  const fromAbs = safeRelIn(stagingDir, filename);
  try {
    await fs.access(fromAbs);
  } catch {
    throw notFound(`暂存文件不存在：${filename}`);
  }
  const st = await fs.stat(fromAbs);
  if (st.isDirectory()) throw badRequest(`暂存路径是目录：${filename}`);
  const { finalName } = await moveFile(fromAbs, activeDir, filename);
  return finalName;
}

/** 删除文件（存在才删，不抛错）。 */
export async function removeFile(dir: string, filename: string): Promise<boolean> {
  const abs = safeRelIn(dir, filename);
  try {
    await fs.unlink(abs);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    throw toApiError(err);
  }
}

/** 上传的临时文件落盘：校验后写入 staging。返回最终文件名与大小。 */
export async function persistUpload(
  blob: Blob,
  originalName: string,
  stagingDir: string,
): Promise<{ name: string; size: number }> {
  const safeName = path.basename(originalName);
  await ensureDir(stagingDir);
  const finalName = await uniqueName(stagingDir, safeName);
  const targetAbs = path.join(stagingDir, finalName);
  const buf = Buffer.from(await blob.arrayBuffer());
  await fs.writeFile(targetAbs, buf);
  return { name: finalName, size: buf.byteLength };
}

/** 拼出目录内不冲突的唯一文件名（存在则追加序号）。 */
async function uniqueName(dir: string, base: string): Promise<string> {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let candidate = base;
  let i = 2;
  while (true) {
    try {
      await fs.access(path.join(dir, candidate));
    } catch {
      return candidate;
    }
    candidate = `${stem} (${i})${ext}`;
    i += 1;
  }
}

/** 便捷：从异常中归一化 ApiError（未知错误转 500）。 */
export { toApiError, ApiError };