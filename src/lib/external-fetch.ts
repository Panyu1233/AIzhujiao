import dns from 'node:dns/promises';
import net from 'node:net';

export interface ExternalFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface ExternalFetchResult {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.')
    );
  }
  return false;
}

async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('外部 API 地址不合法');
  }
  if (url.protocol !== 'https:') throw new Error('外部 API 必须使用 HTTPS');
  if (url.username || url.password) throw new Error('外部 API 地址不能包含用户名或密码');
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('不允许访问本机或内网地址');
  }

  const literalIp = net.isIP(hostname);
  const addresses = literalIp
    ? [hostname]
    : (await dns.lookup(hostname, { all: true, verbatim: true })).map((item) => item.address);
  if (addresses.length === 0) throw new Error('外部 API 域名无法解析');
  if (addresses.some(isPrivateIp)) throw new Error('不允许访问本机或内网地址');
  return url;
}

function sanitizeHeaders(input: Record<string, string> | undefined): Record<string, string> {
  if (!input) return {};
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) continue;
    if (/^(host|content-length|connection|transfer-encoding)$/i.test(name)) continue;
    result[name] = String(rawValue).replace(/[\r\n]/g, ' ').slice(0, 4096);
  }
  return result;
}

/** 仅允许公网 HTTPS，支持手动跟随重定向并逐跳校验目标地址。 */
export async function fetchExternalResource(
  rawUrl: string,
  opts: ExternalFetchOptions = {},
): Promise<ExternalFetchResult> {
  let current = rawUrl;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const url = await assertSafeUrl(current);
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'AI-Teaching-Assistant/1.0',
        ...sanitizeHeaders(opts.headers),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`外部 API 返回重定向但没有 Location（HTTP ${response.status}）`);
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      throw new Error(`外部 API 请求失败：HTTP ${response.status}`);
    }

    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) {
      throw new Error(`外部 API 返回内容过大（${declared} bytes）`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`外部 API 返回内容过大（${buffer.length} bytes）`);
    }
    return {
      buffer,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      finalUrl: url.toString(),
    };
  }
  throw new Error('外部 API 重定向次数过多');
}

/** 从 URL 提取一个安全的下载文件名。 */
export function filenameFromUrl(raw: string, fallback: string): string {
  try {
    const url = new URL(raw);
    const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '')
      .replace(/[<>:\"/\\|?*\x00-\x1f]/g, '_')
      .trim();
    return name || fallback;
  } catch {
    return fallback;
  }
}
