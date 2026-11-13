import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { listChatRecords } from '@/lib/chat-records';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function optionalParam(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function optionalInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 用户聊天记录列表。
 * GET /api/admin/chat-records
 * 以手机号 phone 为核心索引，支持内容、方向、类型、日期与分页筛选。
 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const search = req.nextUrl.searchParams;
    const data = await listChatRecords({
      phone: optionalParam(search.get('phone')),
      keyword: optionalParam(search.get('keyword')),
      direction: optionalParam(search.get('direction')),
      msgType: optionalParam(search.get('msgType')),
      from: optionalParam(search.get('from')),
      to: optionalParam(search.get('to')),
      page: optionalInt(search.get('page')),
      pageSize: optionalInt(search.get('pageSize')),
    });
    return adminOk(data);
  });
}
