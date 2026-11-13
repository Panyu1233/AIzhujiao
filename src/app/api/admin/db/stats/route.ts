import { type NextRequest, NextResponse } from 'next/server';
import { runApi } from '@/lib/api-route';
import { dbListFiles } from '@/lib/db-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 数据库持久化状态。
 * GET /api/admin/db/stats — 数据库里已备份的正式库文件数
 */
export async function GET(req: NextRequest) {
  return runApi(async () => {
    const files = await dbListFiles('active');
    return NextResponse.json({
      success: true,
      data: { zone: 'active', total: files.length, files: files.map((f) => ({ name: f.name, size: f.size })) },
    });
  });
}