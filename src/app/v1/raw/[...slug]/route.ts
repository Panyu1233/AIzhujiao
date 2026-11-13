import { createReadStream, promises as fs, type Stats } from 'fs';
import { Readable } from 'stream';
import { type NextRequest } from 'next/server';
import { config, ROOT_FOLDER_ID } from '@/lib/config';
import { ApiError, errorBody } from '@/lib/errors';
import { isAuthorized } from '@/lib/auth';
import { normalizeRelId } from '@/lib/file-repo';
import { getMimeType, isInlinePreviewable } from '@/lib/file-types';
import { dbGetFileContent } from '@/lib/db-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 原始文件下载 / 内联预览端点（FastGPT 通过 content 接口返回的 previewUrl 访问本端点）。
 *
 * 重要：FastGPT 服务端下载 previewUrl 时不会携带 Authorization 头，
 * 因此本端点默认不强制鉴权（REQUIRE_RAW_TOKEN=false）。
 * 如需收紧，可设置 REQUIRE_RAW_TOKEN=true，并使用 ?token=xxx 或 Authorization 头访问。
 */
function errorResponse(err: ApiError): Response {
  return Response.json(errorBody(err), {
    status: err.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function checkOptionalAuth(req: NextRequest): boolean {
  if (!config.requireRawToken) return true;
  if (isAuthorized(req)) return true;
  const queryToken = req.nextUrl.searchParams.get('token');
  const expected = config.authToken;
  if (!queryToken || !expected) return false;
  let diff = queryToken.length ^ expected.length;
  for (let i = 0; i < Math.max(queryToken.length, expected.length); i++) {
    diff |= (queryToken.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function resolveFile(slug: string[]): Promise<{ abs: string; name: string }> {
  const idInput = slug.map(s => decodeURIComponent(s)).join('/');
  const id = normalizeRelId(idInput);
  if (!id || id === ROOT_FOLDER_ID) {
    throw new ApiError(400, 'BAD_REQUEST', '非法的文件路径');
  }
  // id 已经过目录逃逸校验；再次用 resolve 做防御性检查
  // 注意：raw 端点为审核通过后的有效文件服务，解析基准是 active 区（ACTIVE_ROOT），
  // 而非知识库根目录——文件实际位于 <root>/active 下。
  const abs = `${config.activeRoot}/${id.split('/').join('/')}`;
  const resolvedRoot = await fs.realpath(config.activeRoot);
  const resolvedTarget = await fs.realpath(abs).catch(() => null);
  if (!resolvedTarget || !resolvedTarget.startsWith(resolvedRoot + '/')) {
    throw new ApiError(404, 'NOT_FOUND', '文件不存在');
  }
  return { abs: resolvedTarget, name: id.split('/').pop() ?? 'file' };
}

function buildHeaders(
  name: string,
  size: number,
  mtimeMs: number,
  forceDownload: boolean,
  range?: { start: number; end: number },
): Headers {
  const mime = getMimeType(name);
  const inline = isInlinePreviewable(name) && !forceDownload;
  const disposition = inline ? 'inline' : 'attachment';
  const etag = `"${size.toString(16)}-${Math.floor(mtimeMs / 1000).toString(16)}"`;
  const headers = new Headers({
    'Content-Type': mime,
    'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=30',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  });
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
  } else {
    headers.set('Content-Length', String(size));
  }
  return headers;
}

async function handle(req: NextRequest, ctx: { params: Promise<{ slug?: string[] }> }) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return errorResponse(new ApiError(405, 'METHOD_NOT_ALLOWED', '仅允许 GET/HEAD'));
  }
  if (!checkOptionalAuth(req)) {
    return errorResponse(
      new ApiError(401, 'UNAUTHORIZED', '未授权：raw 文件端点开启了 token 校验'),
    );
  }

  let resolved: { abs: string; name: string };
  let st: Stats;
  // 数据库兜底内容：当文件系统被清空（生产 /tmp 重建）时从 kb_files 取回文件字节
  let dbBuffer: Buffer | undefined;
  let dbName = '';
  try {
    const { slug } = await ctx.params;
    if (!slug || slug.length === 0) {
      throw new ApiError(400, 'BAD_REQUEST', '缺少文件路径');
    }
    resolved = await resolveFile(slug);
    st = await fs.stat(resolved.abs);
    if (!st.isFile()) throw new ApiError(404, 'NOT_FOUND', '目标不是文件');
  } catch (err) {
    if (err instanceof ApiError && err.status !== 404) {
      return errorResponse(err);
    }
    // 文件系统不可用（或 404）时，回退读数据库正式库内容
    const { slug } = await ctx.params;
    const id = slug!.map(s => decodeURIComponent(s)).join('/');
    const rel = normalizeRelId(id);
    dbName = rel && rel !== ROOT_FOLDER_ID ? rel.split('/').pop() ?? rel : '';
    try {
      const hit = await dbGetFileContent(rel ?? '');
      if (hit.content && hit.row) {
        dbBuffer = hit.content;
        st = {
          size: hit.row.size,
          mtimeMs: Date.now(),
        } as Stats;
        resolved = { abs: '', name: dbName };
      } else {
        return errorResponse(new ApiError(404, 'NOT_FOUND', '文件不存在'));
      }
    } catch (dbErr) {
      if (err instanceof ApiError) return errorResponse(err);
      console.error('[raw-file]', dbErr);
      return errorResponse(new ApiError(500, 'INTERNAL_ERROR', '读取文件失败'));
    }
  }

  const forceDownload = req.nextUrl.searchParams.get('download') === '1';
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs / 1000).toString(16)}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const rangeHeader = req.headers.get('range');
  let range: { start: number; end: number } | null = null;
  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!m || (!m[1] && !m[2])) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${st.size}` },
      });
    }
    let start: number;
    let end: number;
    if (!m[1]) {
      // suffix range: bytes=-N
      const suffix = Number(m[2]);
      start = Math.max(0, st.size - suffix);
      end = st.size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] ? Number(m[2]) : st.size - 1;
    }
    if (start > end || start >= st.size) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${st.size}` },
      });
    }
    end = Math.min(end, st.size - 1);
    range = { start, end };
  }

  const status = range ? 206 : 200;
  const headers = buildHeaders(resolved.name, st.size, st.mtimeMs, forceDownload, range ?? undefined);

  if (req.method === 'HEAD') {
    return new Response(null, { status, headers });
  }

  // 数据库兜底路径：无本地文件，直接内存流式返回
  if (dbBuffer) {
    let payload: Uint8Array = dbBuffer;
    if (range) {
      payload = dbBuffer.subarray(range.start, range.end + 1);
    }
    const slice = new Uint8Array(payload.length);
    slice.set(payload);
    return new Response(slice.buffer, { status, headers });
  }

  const nodeStream = createReadStream(resolved.abs, range ? { start: range.start, end: range.end } : undefined);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
  return new Response(webStream, { status, headers });
}

export { handle as GET, handle as HEAD };
