import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config';
import { ensureDir } from './file-utils';

/**
 * 火山同步状态记录。
 *
 * 只记录「某个正式库文件（按文件名）最后成功同步到火山的时间戳」。
 * 通过对比本地文件 mtime 与该时间戳，可判定三态：
 * - 火山中无此文件 && 从未同步       → 本地（local）
 * - 火山中有此文件 && 本地 mtime 晚于最后同步 → 修改（modified，本地已更新待再同步）
 * - 火山中有此文件 && 本地 mtime 不晚于最后同步 → 入库（synced）
 * 状态文件存放于知识库根目录（.volcano-sync-state.json），不入 git。
 */
export type SyncState = Record<string, number>;

let cache: SyncState | null = null;

async function loadState(): Promise<SyncState> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(config.volcanoSyncStatePath, 'utf8');
    cache = JSON.parse(raw) as SyncState;
  } catch {
    cache = {};
  }
  return cache;
}

async function persist() {
  await ensureDir(path.dirname(config.volcanoSyncStatePath));
  await fs.writeFile(
    config.volcanoSyncStatePath,
    JSON.stringify(cache ?? {}, null, 2),
    'utf8',
  );
}

/** 记录某文件成功同步到火山的时间戳（用本地 mtime，保证 "最晚" 语义准确对比）。 */
export async function markSynced(filename: string, localMtime: number): Promise<void> {
  const state = await loadState();
  state[filename] = localMtime;
  await persist();
}

/**
 * 标记某文件存在"未同步的新版本"（本地确认上传覆盖更新后，尚未重新同步到火山）。
 * 将同步记录置为 0，使 mtime > 0 → 判定为「修改」。
 */
export async function markPendingSync(filename: string): Promise<void> {
  const state = await loadState();
  state[filename] = 0;
  await persist();
}

/** 获取某文件的最后同步时间戳（无则 0）。 */
export async function lastSyncedAt(filename: string): Promise<number> {
  const state = await loadState();
  return state[filename] ?? 0;
}

/** 获取全部同步状态记录（文件名 → 最后同步时间戳）。 */
export async function getAllSyncState(): Promise<SyncState> {
  return loadState();
}