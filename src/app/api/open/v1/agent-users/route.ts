import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import {
  listAgentUsers,
  optionalQueryInt,
  optionalQueryText,
} from '@/lib/open-data-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/open/v1/agent-users：查看 Supabase 智能体原始用户信息表。 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const search = req.nextUrl.searchParams;
    return adminOk(await listAgentUsers({
      phone: optionalQueryText(search.get('phone')),
      keyword: optionalQueryText(search.get('keyword')),
      calibrationStatus: optionalQueryText(search.get('calibrationStatus')),
      page: optionalQueryInt(search.get('page')),
      pageSize: optionalQueryInt(search.get('pageSize')),
    }));
  });
}
