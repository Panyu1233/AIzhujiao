import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { calibrateUsersByPhone } from '@/lib/user-calibration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/user-kb/calibrate：按手机号校准小程序与智能体用户。 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const result = await calibrateUsersByPhone();
    return adminOk(result);
  });
}
