/**
 * admin 管理端写操作安全层（Admin Filesystem Safety Adapter）
 *
 * - 仅用于管理后台的写操作（上传 / 建目录 / 删除），与只读的 file-repo 分层。
 * - 所有写操作必须先对相对路径做 strict 校验，拒绝绝对路径、`..`、盘符、URL scheme、
 *   NUL 与路径分隔符注入，防止恶意覆盖 KNOWLEDGE_BASE_ROOT 之外的系统文件。
 * - 统一输出结构化操作日志，方便排查。
 */
import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config';

/** 日志前缀：可在服务日志中按关键字过滤 admin 操作。 */
const TAG = '[admin-fs]';

/** 校验通过后返回"规范化后的相对 POSIX 路径"；非法则抛出 ApiError。 */
const API_ERROR_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  403: 'FORBIDDEN',
  500: 'INTERNAL_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
};

export class AdminFsError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AdminFsError';
    this.status = status;
    this.code = code;
  }
}

export const adminBadRequest = (message: string): AdminFsError =>
  new AdminFsError(400, 'BAD_REQUEST', message);
export const adminNotFound = (message: string): AdminFsError =>
  new AdminFsError(404, 'NOT_FOUND', message);
export const adminConflict = (message: string): AdminFsError =>
  new AdminFsError(409, 'CONFLICT', message);
export const adminForbidden = (message: string): AdminFsError =>
  new AdminFsError(403, 'FORBIDDEN', message);

/** 把任意异常归一为 AdminFsError。 */
export function toAdminError(err: unknown): AdminFsError {
  if (err instanceof AdminFsError) return err;
  const message = err instanceof Error ? err.message : '内部服务器错误';
  return new AdminFsError(500, 'INTERNAL_ERROR', message);
}

interface ErrLike {
  status?: number;
  code?: string;
  message?: string;
}

/** 兼容 file-repo 抛出的带 status 的普通 Error。 */
export function normalizeAdminError(err: unknown): AdminFsError {
  if (err instanceof AdminFsError) return err;
  if (err && typeof err === 'object') {
    const e = err as ErrLike;
    if (typeof e.status === 'number' && API_ERROR_CODES[e.status]) {
      return new AdminFsError(e.status, e.code ?? API_ERROR_CODES[e.status], e.message ?? '');
    }
  }
  return toAdminError(err);
}

/** 断言绝对路径位于知识库根目录内（realpath 归一化，用于"目标已存在"场景）。 */
async function assertWithinRoot(abs: string): Promise<void> {
  const root = await fs.realpath(config.knowledgeBaseRoot);
  const target = await fs.realpath(abs).catch(() => null);
  if (!target || !target.startsWith(root + path.sep)) {
    throw adminForbidden('路径越界：目标不在知识库根目录内');
  }
}

/**
 * 逐级校验从知识库根目录到目标路径之间的已存在层级不含符号链接。
 * 适用于"目标可能尚不存在"（新建文件/新建文件夹）的写入场景：
 * 不要求目标本身存在，但若命中任一已存在的符号链接目录则拒绝写入，防止逃逸。
 */
async function assertNoSymlinkAlong(targetAbs: string): Promise<void> {
  const root = path.resolve(config.knowledgeBaseRoot);
  const rel = path.relative(root, targetAbs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw adminForbidden('路径越界：目标不在知识库根目录内');
  }
  const parts = rel.split(path.sep).filter(Boolean);
  let cur = root;
  for (const part of parts) {
    cur = path.join(cur, part);
    const st = await fs.lstat(cur).catch(() => null);
    if (!st) break; // 到第一个尚不存在的层级为止即可
    if (st.isSymbolicLink()) {
      throw adminForbidden('路径包含符号链接，已拒绝写入');
    }
  }
}

/**
 * 严格校验相对路径。
 * - 空/root => 拒绝（管理写操作必须指向具体节点）
 * - 拆分段校验：拒绝 `..`、`.`、空段（连续斜杠）、NUL、盘符、URL scheme、反斜杠段
 */
export function assertSafeRel(input: string): string {
  const trimmed = (input ?? '').trim();
  if (trimmed === '' || trimmed === 'root' || trimmed === '.' || trimmed === '/') {
    throw adminBadRequest('必须指定一个具体的相对路径（不能是根目录）');
  }
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw adminBadRequest('非法的相对路径');
  }
  for (const seg of segments) {
    if (seg === '..' || seg === '.') throw adminForbidden('非法路径段：.. 或 .');
    if (seg.includes('\0')) throw adminBadRequest('路径包含 NUL 字符');
    if (seg.includes('\\')) throw adminBadRequest('路径段内不允许含有反斜杠 \\ 或反斜杠路径');
    if (/^[a-zA-Z]:$/.test(seg) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(seg)) {
      throw adminForbidden('路径段疑似盘符或 URL scheme');
    }
  }
  if (segments.some(s => s.includes(':') && /^[a-zA-Z]/.test(s))) {
    // Windows 盘符形如 C: 已在上面拦截；这里兜底剩余含冒号段
    throw adminForbidden('路径段包含非法冒号');
  }
  const rel = segments.join('/');
  if (rel.includes('..') || rel.startsWith('/') || rel.startsWith('\\')) {
    throw adminForbidden('路径越界');
  }
  return rel;
}

/** 由相对路径解析出根目录内的绝对路径（未做 exist 检查，供新建场景使用）。 */
export function safeTarget(rel: string): string {
  return path.join(config.knowledgeBaseRoot, ...rel.split('/'));
}

/** 安全地从相对路径解析出一个已存在的目标绝对路径，并校验其在根目录内。 */
export async function safeResolve(rel: string): Promise<string> {
  const safeRel = assertSafeRel(rel);
  const abs = safeTarget(safeRel);
  await assertWithinRoot(abs);
  return abs;
}

/** 生成重复文件不冲突的文件名：在扩展名之前追加 ` (2)`、` (3)` ...  */
async function dedupeName(dir: string, filename: string): Promise<string> {
  const ext = path.extname(filename);
  const base = ext ? filename.slice(0, -ext.length) : filename;
  let candidate = filename;
  let i = 2;
  const fileExists = async (name: string) => {
    try {
      await fs.access(path.join(dir, name));
      return true;
    } catch {
      return false;
    }
  };
  while (await fileExists(candidate)) {
    candidate = ext ? `${base} (${i})${ext}` : `${base} (${i})`;
    i += 1;
  }
  return candidate;
}

export interface WriteResult {
  savedName: string;
  absPath: string;
  overwritten: boolean;
  size: number;
}

/** 将上传文件保存到知识库根目录下（folder 相对路径 + 可选覆盖/重命名策略）。 */
export async function writeUpload(
  file: File,
  folderRel?: string | null,
  opts?: { overwrite?: boolean },
): Promise<WriteResult> {
  const overwrite = opts?.overwrite ?? false;
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength === 0) throw adminBadRequest('上传文件为空');

  const baseDir = folderRel ? safeTarget(assertSafeRel(folderRel)) : config.knowledgeBaseRoot;

  // 文件名：取 basename 并剔除路径分隔符，绝不允许文件名内携带目录层级
  let rawName = file.name.replace(/\\/g, '/').split('/').pop() ?? '';
  if (!rawName.trim()) rawName = 'unnamed';
  if (rawName.includes('\0')) throw adminBadRequest('文件名包含非法字符');

  let savedName: string;
  const overwritten = false;
  if (overwrite) {
    savedName = rawName;
  } else {
    // 已存在则自动重命名，绝不静默覆盖
    savedName = rawName;
    const exists = await fs
      .access(path.join(baseDir, savedName))
      .then(() => true)
      .catch(() => false);
    if (exists) {
      savedName = await dedupeName(baseDir, rawName);
    }
  }

  const abs = path.join(baseDir, savedName);
  // 防逃逸校验：逐级检查已存在层级无符号链接；文件本身尚不存在，无需 realpath
  await assertNoSymlinkAlong(abs);
  await fs.mkdir(baseDir, { recursive: true });
  await fs.writeFile(abs, buf);

  log('upload', `保存文件 ${folderRel ? folderRel + '/' : ''}${savedName} (${buf.byteLength}B, overwrite=${overwrite})`);
  return { savedName, absPath: abs, overwritten, size: buf.byteLength };
}

/** 创建知识库内文件夹（允许递归创建多级）。 */
export async function createFolder(rel: string): Promise<string> {
  const safeRel = assertSafeRel(rel);
  const abs = safeTarget(safeRel);
  const existing = await fs
    .access(abs)
    .then(() => true)
    .catch(() => false);
  if (existing) throw adminConflict(`文件夹已存在：${safeRel}`);
  // 防逃逸校验：新建层级之前逐级确认既有目录无符号链接
  await assertNoSymlinkAlong(abs);
  await fs.mkdir(abs, { recursive: true });
  log('folder', `创建文件夹 ${safeRel}`);
  return safeRel;
}

/** 删除知识库内文件或空目录（rel 相对路径）。拒绝删除根。 */
export async function removeNode(rel: string): Promise<{ removed: 'file' | 'folder'; rel: string }> {
  const safeRel = assertSafeRel(rel);
  const abs = safeTarget(safeRel);
  const st = await fs.stat(abs).catch(() => null);
  if (!st) throw adminNotFound('目标不存在');
  // 对已存在的目标做 realpath 逃逸校验（防符号链接指向根目录外）
  const root = await fs.realpath(config.knowledgeBaseRoot);
  const target = await fs.realpath(abs);
  if (!target.startsWith(root + path.sep)) {
    throw adminForbidden('路径越界：目标不在知识库根目录内');
  }
  if (st.isDirectory()) {
    // 目录：仅允许删除空目录，避免误删整棵子树
    const children = await fs.readdir(target);
    if (children.length > 0) throw adminConflict('目录非空，无法删除；请先删除其中的文件');
    await fs.rmdir(target);
    log('delete', `删除空目录 ${safeRel}`);
    return { removed: 'folder', rel: safeRel };
  }
  if (st.isFile()) {
    await fs.unlink(target);
    log('delete', `删除文件 ${safeRel}`);
    return { removed: 'file', rel: safeRel };
  }
  throw adminBadRequest('目标既不是文件也不是目录');
}

/** 结构化日志：便于在运行时日志中按 [admin-fs] 过滤管理操作。 */
export function log(op: string, detail: string): void {
  const ts = new Date().toISOString();
  // 不打任何 token/密钥；路径为相对路径，不含绝对系统路径
  console.info(`${TAG} ${ts} op=${op} ${detail}`);
}

