import { promises as fs } from 'fs';
import { type NextRequest } from 'next/server';
import { jsonSuccess, runApi } from '@/lib/api-route';
import { config } from '@/lib/config';
import { badRequest } from '@/lib/errors';
import { getNode } from '@/lib/file-repo';
import { isTextFile } from '@/lib/file-types';
import { buildRawFileUrl } from '@/lib/urls';
import { dbGetFileContent } from '@/lib/db-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 获取单个文件内容（文本内容或访问链接）
 * GET /api/open/v1/file/content?id=xxx
 * - 以数据库 kb_files（正式库）为权威：能取到 content 则优先返回内容，
 *   文本类返回 content；二进制/超大走 previewUrl 兜底
 * - 数据库内容缺失时才回退读文件系统 active 目录
 */
export async function GET(req: NextRequest) {
  return runApi(async () => {
    const id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
    if (!id) throw badRequest('缺少必填参数 id');

    // 1) 优先从数据库正式库读内容
    const dbHit = await dbGetFileContent(id, 'active');
    const previewUrl =
      dbHit.content && dbHit.row
        ? buildRawFileUrl(req.headers, id)
        : '';

    if (dbHit.content && dbHit.row) {
      const size = dbHit.row.size;
      const contentType =
        dbHit.row.content_type ?? inferFromName(id);
      // 文本类：直接返回内容（向量化用）
      if (isTextFile(id) && size <= config.maxTextBytes) {
        const content = dbHit.content
          .toString('utf-8')
          .replace(/^\uFEFF/, '');
        const url =
          previewUrl ||
          buildRawFileUrl(req.headers, id);
        return jsonSuccess({ title: id, content, previewUrl: url });
      }
      // 二进制或超大：返回下载链接由 FastGPT 解析
      const url =
        previewUrl || buildRawFileUrl(req.headers, id);
      return jsonSuccess({ title: id, previewUrl: url, contentType });
    }

    // 2) 数据库无内容兜底：读文件系统 active
    const node = await getNode(id);
    if (node.type !== 'file') throw badRequest('id 指向的是文件夹，不是文件');

    const url = buildRawFileUrl(req.headers, node.id);

    if (isTextFile(node.name) && node.size <= config.maxTextBytes) {
      const raw = await fs.readFile(node.absolutePath);
      const content = raw.toString('utf-8').replace(/^\uFEFF/, '');
      return jsonSuccess({ title: node.name, content, previewUrl: url });
    }

    return jsonSuccess({ title: node.name, previewUrl: url });
  });
}

function inferFromName(name: string): string {
  const idx = name.lastIndexOf('.');
  const ext = idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
  const mime: Record<string, string> = {
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pdf: 'application/pdf',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
  };
  return mime[ext] ?? 'application/octet-stream';
}