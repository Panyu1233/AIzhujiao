import { type NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { commitStagingFile, listStaging } from '@/lib/stage-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 确认入库：把暂存区文件复制到索引区（KNOWLEDGE_BASE_ROOT）并刷新索引，
 * 之后才被 FastGPT / 火山知识库拉取到。
 * POST /api/admin/stage/commit  body: { "rel": "<暂存相对路径>" }
 * 也支持：body: { "all": true } 确认全部。
 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const body = (await req.json().catch(() => null)) as { rel?: unknown; all?: unknown } | null;
    const all = !!body && body.all === true;

    if (!all) {
      const rel = body && typeof body.rel === 'string' ? body.rel.trim() : '';
      if (!rel) throw new Error('请提供 rel（暂存文件相对路径）或 all=true 确认全部');
      const committed = await commitStagingFile(rel);
      return adminOk({ committed });
    }

    // 确认全部
    const files = await listStaging();
    const results = [];
    const errors: string[] = [];
    for (const f of files) {
      try {
        const committed = await commitStagingFile(f.rel);
        results.push({ rel: f.rel, target: committed.rel });
      } catch (e) {
        errors.push(`${f.rel}: ${e instanceof Error ? e.message : '未知错误'}`);
      }
    }
    return adminOk({ committed: results, failed: errors }, errors.length ? 207 : 200);
  });
}