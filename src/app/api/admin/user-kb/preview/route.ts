import type { NextRequest } from 'next/server';
import { runAdmin } from '@/lib/admin-route';
import { renderFilePreview } from '@/lib/docx-preview';
import { userKbGetFile } from '@/lib/user-kb-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/user-kb/preview?name=<文件名>，返回可直接在浏览器渲染的 HTML。 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const name = req.nextUrl.searchParams.get('name')?.trim() ?? '';
    if (!name) throw new Error('缺少参数 name');
    const detail = await userKbGetFile(name);
    if (!detail || !detail.content) throw new Error('文件不存在或内容为空');
    const html = await renderFilePreview(name, detail.content);
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  });
}