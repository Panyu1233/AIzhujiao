import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import {
  listLocalKnowledgeFiles,
  optionalQueryInt,
  optionalQueryText,
} from '@/lib/open-data-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/open/v1/knowledge-files：查看本地底层知识库正式库（active）全部文件。 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const search = req.nextUrl.searchParams;
    return adminOk(await listLocalKnowledgeFiles({
      keyword: optionalQueryText(search.get('keyword')),
      format: optionalQueryText(search.get('format')),
      page: optionalQueryInt(search.get('page')),
      pageSize: optionalQueryInt(search.get('pageSize')),
    }));
  });
}
