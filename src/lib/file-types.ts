/**
 * 文件类型与 MIME 判断。
 * 文本类文件由 /v1/file/content 直接内联返回纯文本；
 * 二进制文件（PDF / Word / 图片等）返回 previewUrl，由 FastGPT 自行下载解析。
 */

const TEXT_EXTENSIONS = new Set([
  'txt',
  'text',
  'md',
  'markdown',
  'mdx',
  'json',
  'jsonl',
  'csv',
  'tsv',
  'log',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'xhtml',
  'css',
  'scss',
  'less',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'vue',
  'svelte',
  'py',
  'rb',
  'go',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'cc',
  'cxx',
  'hpp',
  'hh',
  'rs',
  'php',
  'sh',
  'bash',
  'zsh',
  'fish',
  'sql',
  'ini',
  'conf',
  'cfg',
  'config',
  'toml',
  'env',
  'properties',
  'gradle',
  'dockerfile',
  'gitignore',
  'editorconfig',
  'rst',
  'tex',
  'org',
  'asciidoc',
  'adoc',
  'srt',
  'vtt',
  'sub',
]);

const MIME_MAP: Record<string, string> = {
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  yaml: 'application/yaml; charset=utf-8',
  yml: 'application/yaml; charset=utf-8',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
};

const FALLBACK_BINARY_MIME = 'application/octet-stream';

export function getExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx <= 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase();
}

export function isTextFile(name: string): boolean {
  const ext = getExtension(name);
  if (!ext) return false;
  return TEXT_EXTENSIONS.has(ext);
}

export function getMimeType(name: string): string {
  const ext = getExtension(name);
  return MIME_MAP[ext] ?? FALLBACK_BINARY_MIME;
}

/** 是否为可在浏览器内联预览的类型（PDF / 文本 / 图片等）。 */
export function isInlinePreviewable(name: string): boolean {
  const mime = getMimeType(name);
  return (
    mime.startsWith('text/') ||
    mime === 'application/pdf' ||
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/')
  );
}
