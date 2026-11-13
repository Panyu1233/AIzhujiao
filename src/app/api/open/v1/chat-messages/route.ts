import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import {
  listChatMessages,
  optionalQueryInt,
  optionalQueryText,
} from '@/lib/open-data-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/open/v1/chat-messages：查看已上传数据库的用户聊天记录。 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const search = req.nextUrl.searchParams;
    return adminOk(await listChatMessages({
      phone: optionalQueryText(search.get('phone')),
      keyword: optionalQueryText(search.get('keyword')),
      direction: optionalQueryText(search.get('direction')),
      msgType: optionalQueryText(search.get('msgType')),
      from: optionalQueryText(search.get('from')),
      to: optionalQueryText(search.get('to')),
      page: optionalQueryInt(search.get('page')),
      pageSize: optionalQueryInt(search.get('pageSize')),
    }));
  });
}
