import { config } from './config';

/**
 * 解析对外可访问的站点基地址。
 * 优先级：PUBLIC_BASE_URL > 请求头 x-forwarded-* / host。
 * 阿里云 SLB、Nginx、ACK Ingress 等反向代理通常会传入 x-forwarded-proto / x-forwarded-host。
 */
export function getPublicBaseUrl(headers: Headers): string {
  if (config.publicBaseUrl) return config.publicBaseUrl;

  const forwardedProto = headers.get('x-forwarded-proto');
  const forwardedHost = headers.get('x-forwarded-host');
  const host = headers.get('host');
  const proto = forwardedProto?.split(',')[0].trim() || 'https';
  const hostname =
    (forwardedHost?.split(',')[0].trim() || host || 'localhost')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
  return `${proto}://${hostname}`;
}

/** 原始文件下载/预览地址，FastGPT 会直接 GET 该地址，不带 Authorization 头。 */
export function buildRawFileUrl(
  headers: Headers,
  fileId: string,
  options: { download?: boolean } = {},
): string {
  const base = getPublicBaseUrl(headers);
  const suffix = options.download ? '?download=1' : '';
  return `${base}/v1/raw/${fileId.split('/').map(encodeURIComponent).join('/')}${suffix}`;
}
