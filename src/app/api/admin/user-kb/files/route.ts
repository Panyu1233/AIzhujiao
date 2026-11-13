import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { userKbListFiles, userKbStats } from '@/lib/user-kb-files';
import { getUserCalibrationStats } from '@/lib/user-calibration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 用户信息文件列表（与底层知识库完全独立）。
 * GET /api/admin/user-kb/files
 * 返回用户信息全部本地文件 + 统计；数据库仅在正式库点击上传后写入。
 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const [files, stats] = await Promise.all([userKbListFiles(), userKbStats()]);
    const calibration = await getUserCalibrationStats().catch(() => null);
    return adminOk({
      files,
      count: stats.count,
      totalBytes: stats.totalBytes,
      calibration,
      source: 'filesystem',
    });
  });
}
