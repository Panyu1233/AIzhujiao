import { type NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { createFolder } from '@/lib/adminfs';
import { refreshIndex } from '@/lib/file-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 创建知识库内的文件夹（支持多级路径）。
 * POST /api/admin/folder  body: { "path": "品牌/新品" }
 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const body = (await req.json().catch(() => null)) as { path?: unknown } | null;
    const rel =
      body && typeof body.path === 'string' ? body.path.trim() : '';
    const created = await createFolder(rel);
    await refreshIndex();
    return adminOk({ relPath: created }, 201);
  });
}