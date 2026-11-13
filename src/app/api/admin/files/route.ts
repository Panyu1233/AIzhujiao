import { type NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { config } from '@/lib/config';
import { listFiles } from '@/lib/file-utils';
import { listStaging } from '@/lib/stage-repo';
import { listVolcanoDocNames } from '@/lib/volcano-sync';
import { getAllSyncState } from '@/lib/volcano-state';
import { inferFormat } from '@/lib/db-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ActiveRow {
  name: string;
  size: number;
  updateTime: string;
  rel: string;
  inVolcano: boolean;
  syncStatus: 'local' | 'modified' | 'synced';
  format: string;
}

/**
 * 全部文件列表 API。
 * 暂存区和正式库都以本地文件系统为唯一文件来源；数据库只在显式同步知识库时写入。
 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const [active, staged, volcanoNames, syncState] = await Promise.all([
      listFiles(config.activeRoot),
      listStaging(),
      listVolcanoDocNames().catch(() => new Map<string, boolean>()),
      getAllSyncState(),
    ]);

    const inVolcanoOf = (name: string) => volcanoNames.size > 0 && volcanoNames.has(name);
    const syncStatusOf = (name: string, mtime: number): 'local' | 'modified' | 'synced' => {
      if (!inVolcanoOf(name)) return 'local';
      const last = syncState[name];
      return last !== undefined && mtime > last ? 'modified' : 'synced';
    };

    const activeRows: ActiveRow[] = active.map((file) => ({
      name: file.name,
      size: file.size,
      updateTime: new Date(file.mtimeMs).toISOString(),
      rel: `active/${file.name}`,
      inVolcano: inVolcanoOf(file.name),
      syncStatus: syncStatusOf(file.name, file.mtimeMs),
      format: inferFormat(file.name),
    }));

    return adminOk({
      active: activeRows,
      staged: staged.map((file) => ({
        name: file.name,
        size: file.size,
        updateTime: file.updateTime,
        rel: file.rel,
        format: inferFormat(file.name),
      })),
      source: 'filesystem',
      activeCount: activeRows.length,
      stagedCount: staged.length,
    });
  });
}