import { NextResponse, type NextRequest } from 'next/server';
import { runAdmin } from '@/lib/admin-route';
import { chatRecordFileGet } from '@/lib/chat-record-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/chat-records/content?name=<文件名>&download=1。 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const name = req.nextUrl.searchParams.get('name')?.trim() ?? '';
    if (!name) throw new Error('缺少参数 name');
    const detail = await chatRecordFileGet(name);
    if (!detail?.content) throw new Error('聊天记录文件不存在或内容为空');
    const download = req.nextUrl.searchParams.get('download') === '1';
    return new NextResponse(new Uint8Array(detail.content), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': detail.content_type || 'application/json; charset=utf-8',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  });
}
