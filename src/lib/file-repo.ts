/**
 * 文件仓库适配层（File Repository Adapter）
 *
 * - 通过环境变量 KNOWLEDGE_BASE_ROOT 指向知识库根目录，代码中不硬编码绝对路径。
 * - id 直接使用「相对于根目录的 POSIX 路径」，天然稳定、可读、跨重启不变；
 *   根目录 id 为 ROOT_FOLDER_ID（'root'），顶层节点 parentId 为 null。
 * - 启动后懒扫描目录，在内存中维护元数据索引（Map<id, Node>），按 TTL 自动刷新，
 *   文件树 / 详情查询直接命中索引；读取文件内容、流式下载时才访问磁盘。
 * - 安全：不跟随符号链接；所有 id 都做规范化与目录逃逸校验，拒绝 `..` 越权。
 */
import { promises as fs } from 'fs';
import path from 'path';
import { config, ROOT_FOLDER_ID } from './config';

export type NodeType = 'file' | 'folder';

/** 内部节点（含磁盘绝对路径，不允许直接出现在响应中）。 */
interface RepoNode {
  id: string;
  name: string;
  parentId: string | null;
  type: NodeType;
  absolutePath: string;
  updateTime: string;
  createTime: string;
  hasChild: boolean;
  size: number;
}

/** 对外暴露的文件元数据（FastGPT FileListItem / Detail）。 */
export interface FileNodeDTO {
  id: string;
  name: string;
  parentId: string | null;
  type: NodeType;
  updateTime: string;
  createTime: string;
  hasChild: boolean;
}

export interface RepoStats {
  root: string;
  rootName: string;
  configuredRoot: string;
  fileCount: number;
  folderCount: number;
  scannedAt: string;
}

interface Snapshot {
  nodes: Map<string, RepoNode>;
  root: RepoNode;
  stats: Omit<RepoStats, 'configuredRoot'>;
  scannedAt: number;
}

const DEFAULT_IGNORE_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.git',
  'node_modules',
  '__MACOSX',
]);

function toIso(ms: number): string {
  return new Date(ms > 0 ? ms : Date.now()).toISOString();
}

/** id 是相对 POSIX 路径；拒绝绝对路径、盘符、`..` 段，防止目录逃逸。 */
export function normalizeRelId(input: string): string {
  const trimmed = input.trim().replace(/\\/g, '/');
  if (trimmed === '' || trimmed === '/' || trimmed === ROOT_FOLDER_ID || trimmed === '.') {
    return ROOT_FOLDER_ID;
  }
  const segments = trimmed.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg === '..' || seg === '.' || seg.includes('\0')) {
      return '';
    }
    // 盘符（Windows）与 URL scheme
    if (/^[a-zA-Z]:$/.test(seg) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(seg)) {
      return '';
    }
  }
  const rel = segments.join('/');
  return rel === '' ? ROOT_FOLDER_ID : rel;
}

function isIgnored(name: string): boolean {
  if (DEFAULT_IGNORE_NAMES.has(name) || config.ignoreNames.has(name)) return true;
  if (!config.includeHidden && name.startsWith('.')) return true;
  return false;
}

let snapshotPromise: Promise<Snapshot> | null = null;
let snapshot: Snapshot | null = null;

async function scanDirectory(): Promise<Snapshot> {
  // FastGPT 只读 active 目录（审核通过、同步火山成功后的有效文件）。
  const rootDir = config.activeRoot;
  let rootStat;
  try {
    rootStat = await fs.stat(rootDir);
  } catch {
    const err = new Error(
      `知识库有效目录不可访问：${rootDir}（请检查环境变量 ACTIVE_ROOT 与挂载路径）`,
    ) as Error & { status?: number; code?: string };
    err.status = 503;
    err.code = 'ROOT_UNAVAILABLE';
    throw err;
  }
  if (!rootStat.isDirectory()) {
    const err = new Error(`ACTIVE_ROOT 不是目录：${rootDir}`) as Error & {
      status?: number;
      code?: string;
    };
    err.status = 503;
    err.code = 'ROOT_NOT_DIRECTORY';
    throw err;
  }

  const nodes = new Map<string, RepoNode>();
  const rootName = path.basename(rootDir) || 'knowledge-base';
  let fileCount = 0;
  let folderCount = 0;

  const rootNode: RepoNode = {
    id: ROOT_FOLDER_ID,
    name: rootName,
    parentId: null,
    type: 'folder',
    absolutePath: rootDir,
    updateTime: toIso(rootStat.mtimeMs),
    createTime: toIso(rootStat.birthtimeMs || rootStat.ctimeMs),
    hasChild: false,
    size: 0,
  };
  nodes.set(ROOT_FOLDER_ID, rootNode);

  const walk = async (dir: string, relId: string): Promise<boolean> => {
    let entries = await fs.readdir(dir, { withFileTypes: true });
    entries = entries.filter(e => !isIgnored(e.name));
    // 文件夹在前、文件在后；同类按名称使用本地化排序
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'variant' });
    });

    let hasChild = false;
    for (const entry of entries) {
      const childRel = relId === ROOT_FOLDER_ID ? entry.name : `${relId}/${entry.name}`;
      const abs = path.join(dir, entry.name);
      // 不跟随符号链接：lstat 后若是 symlink 直接跳过
      let st;
      try {
        st = await fs.lstat(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;

      const isDir = entry.isDirectory() && st.isDirectory();
      const isFile = entry.isFile() && st.isFile();
      if (!isDir && !isFile) continue;

      hasChild = true;
      const parentId = relId === ROOT_FOLDER_ID ? null : relId;
      const node: RepoNode = {
        id: childRel,
        name: entry.name,
        parentId,
        type: isDir ? 'folder' : 'file',
        absolutePath: abs,
        updateTime: toIso(st.mtimeMs),
        createTime: toIso(st.birthtimeMs || st.ctimeMs),
        hasChild: false,
        size: isFile ? st.size : 0,
      };

      if (isDir) {
        folderCount += 1;
        node.hasChild = await walk(abs, childRel);
      } else {
        fileCount += 1;
      }
      nodes.set(childRel, node);
    }
    return hasChild;
  };

  rootNode.hasChild = await walk(rootDir, ROOT_FOLDER_ID);

  const scannedAt = Date.now();
  const next: Snapshot = {
    nodes,
    root: rootNode,
    scannedAt,
    stats: {
      root: rootDir,
      rootName,
      fileCount,
      folderCount,
      scannedAt: toIso(scannedAt),
    },
  };
  return next;
}

/** 获取索引快照；过期或缺失时触发重新扫描（同一时刻只允许一个扫描任务）。 */
async function getSnapshot(force = false): Promise<Snapshot> {
  const now = Date.now();
  const fresh =
    snapshot !== null && now - snapshot.scannedAt < config.scanCacheTtlMs;
  if (!force && fresh && snapshot) return snapshot;

  if (!snapshotPromise) {
    snapshotPromise = scanDirectory()
      .then(next => {
        snapshot = next;
        return next;
      })
      .finally(() => {
        snapshotPromise = null;
      });
  }
  return snapshotPromise;
}

function toDTO(node: RepoNode): FileNodeDTO {
  return {
    id: node.id === ROOT_FOLDER_ID ? ROOT_FOLDER_ID : node.id,
    name: node.name,
    parentId: node.parentId,
    type: node.type,
    updateTime: node.updateTime,
    createTime: node.createTime,
    hasChild: node.hasChild,
  };
}

/**
 * 列出文件夹的直接子节点；带 searchKey 时在该文件夹整棵子树内按文件名递归检索。
 * parentId 为 null / undefined / 空 / 'root' 时均表示根目录。
 */
export async function listChildren(options: {
  parentId?: string | null;
  searchKey?: string | null;
}): Promise<FileNodeDTO[]> {
  const snap = await getSnapshot();
  const rawParent =
    options.parentId === undefined || options.parentId === null
      ? ROOT_FOLDER_ID
      : normalizeRelId(options.parentId);
  if (!rawParent) {
    const err = new Error('非法的 parentId') as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  const parent = snap.nodes.get(rawParent);
  if (!parent || parent.type !== 'folder') {
    const err = new Error('父文件夹不存在') as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const keyword = options.searchKey?.trim().toLowerCase() ?? '';
  const result: FileNodeDTO[] = [];
  for (const node of snap.nodes.values()) {
    if (node.id === ROOT_FOLDER_ID) continue;
    const underParent =
      rawParent === ROOT_FOLDER_ID
        ? true // 所有非根节点都在根目录子树内（含顶层节点，其 parentId 为 null）
        : node.id === rawParent ||
          node.id.startsWith(`${rawParent}/`) ||
          node.parentId === rawParent;
    if (!underParent) continue;

    if (keyword) {
      // 递归检索：返回该子树内名称命中的任意节点（不含父文件夹自身）
      if (node.id !== rawParent && node.name.toLowerCase().includes(keyword)) {
        result.push(toDTO(node));
      }
    } else if (node.parentId === (rawParent === ROOT_FOLDER_ID ? null : rawParent)) {
      result.push(toDTO(node));
    }
  }
  return result;
}

export async function getNode(idInput: string): Promise<RepoNode> {
  const snap = await getSnapshot();
  const id = normalizeRelId(idInput);
  if (!id) {
    const err = new Error('非法的 id') as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  const node = snap.nodes.get(id);
  if (!node) {
    const err = new Error('文件不存在') as Error & { status?: number; code?: string };
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  return node;
}

export async function getNodeDTO(idInput: string): Promise<FileNodeDTO> {
  return toDTO(await getNode(idInput));
}

export async function getStats(): Promise<RepoStats> {
  const snap = await getSnapshot();
  return { ...snap.stats, configuredRoot: config.knowledgeBaseRoot };
}

/** 强制刷新索引（管理/排障用途）。 */
export async function refreshIndex(): Promise<void> {
  await getSnapshot(true);
}
