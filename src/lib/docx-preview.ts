/** 服务端把本地文件转换成安全的 HTML 页面，供管理端在线预览。 */
import mammoth from 'mammoth';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title: string, body: string, warning = ''): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f5f4; color: #292524; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; }
    header { position: sticky; top: 0; z-index: 1; padding: 14px 24px; background: rgba(255,255,255,.96); border-bottom: 1px solid #e7e5e4; backdrop-filter: blur(8px); }
    header h1 { margin: 0; font-size: 16px; line-height: 1.5; word-break: break-all; }
    header p { margin: 3px 0 0; color: #78716c; font-size: 12px; }
    main { padding: 24px; }
    article { max-width: 1500px; min-height: 200px; margin: 0 auto; padding: 28px 32px; background: #fff; border: 1px solid #e7e5e4; box-shadow: 0 8px 24px rgba(41,37,36,.06); overflow-x: auto; }
    article table { width: 100%; border-collapse: collapse; table-layout: auto; font-size: 13px; }
    article th, article td { border: 1px solid #a8a29e; padding: 8px 10px; vertical-align: top; text-align: left; overflow-wrap: anywhere; white-space: pre-wrap; }
    article th { background: #2f5597; color: #fff; font-weight: 600; text-align: center; }
    article tr:nth-child(even) td { background: #fafaf9; }
    article p { line-height: 1.75; }
    article img { max-width: 100%; height: auto; }
    pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.7 Consolas, "SFMono-Regular", monospace; }
    .warning { max-width: 1500px; margin: 0 auto 14px; padding: 10px 14px; border: 1px solid #fcd34d; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 12px; }
    .empty { color: #78716c; text-align: center; padding: 40px 0; }
    @media print { body { background: #fff; } header, .warning { display: none; } main { padding: 0; } article { max-width: none; padding: 0; border: 0; box-shadow: none; } }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p>本地文件在线预览 · 只读</p>
  </header>
  <main>
    ${warning ? `<div class="warning">${escapeHtml(warning)}</div>` : ''}
    <article>${body || '<p class="empty">文件内容为空</p>'}</article>
  </main>
</body>
</html>`;
}

/** 把 DOCX、JSON 或文本文件渲染成可直接在浏览器打开的 HTML。 */
export async function renderFilePreview(name: string, buffer: Buffer): Promise<string> {
  if (/\.docx$/i.test(name)) {
    const result = await mammoth.convertToHtml({ buffer });
    const warning = result.messages
      .map((message) => message.message)
      .filter(Boolean)
      .slice(0, 3)
      .join('；');
    return page(name, result.value, warning);
  }

  if (/\.(json|txt|md|csv|log)$/i.test(name)) {
    const raw = buffer.toString('utf8');
    let body = raw;
    if (/\.json$/i.test(name)) {
      try {
        body = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        // 非法 JSON 保持原文，避免预览失败。
      }
    }
    return page(name, `<pre>${escapeHtml(body)}</pre>`);
  }

  return page(
    name,
    '<p class="empty">该文件格式暂不支持在线预览，请使用“下载”查看。</p>',
  );
}