import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import {
  listCalibratedUsers,
  optionalQueryInt,
  optionalQueryText,
} from '@/lib/open-data-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/open/v1/calibrated-users：查看按手机号校准后的统一用户信息表。 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const search = req.nextUrl.searchParams;
    return adminOk(await listCalibratedUsers({
      phone: optionalQueryText(search.get('phone')),
      keyword: optionalQueryText(search.get('keyword')),
      calibrationStatus: optionalQueryText(search.get('calibrationStatus')),
      page: optionalQueryInt(search.get('page')),
      pageSize: optionalQueryInt(search.get('pageSize')),
    }));
  });
}
