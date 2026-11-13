import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { chatRecordFilePut } from '@/lib/chat-record-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function defaultName(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `chat-records-${stamp}.json`;
}

/**
 * POST /api/admin/chat-records/upload
 * 外部 API 数据进入暂存区。
 * - multipart/form-data：file=<JSON 文件>，sourceUrl 可选
 * - application/json：直接发送数组，或 { name, sourceUrl, data }
 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const contentType = req.headers.get('content-type') || '';
    let name = defaultName();
    let sourceUrl: string | null = null;
    let content: Buffer;

    if (contentType.includes('application/json')) {
      const body = await req.json();
      if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
        const payload = body as { name?: string; sourceUrl?: string; data: unknown };
        if (payload.name?.trim()) name = payload.name.trim();
        sourceUrl = payload.sourceUrl?.trim() || null;
        content = Buffer.from(JSON.stringify(payload.data));
      } else {
        content = Buffer.from(JSON.stringify(body));
      }
    } else {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File) || file.size === 0) {
        throw new Error('缺少 file 文件，或请使用 application/json 提交数据');
      }
      name = file.name || name;
      sourceUrl = String(form.get('sourceUrl') || '').trim() || null;
      content = Buffer.from(await file.arrayBuffer());
    }

    const row = await chatRecordFilePut(name, content, {
      contentType: 'application/json',
      sourceUrl,
    });
    return adminOk(row, 201);
  });
}
