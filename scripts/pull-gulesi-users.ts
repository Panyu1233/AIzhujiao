/**
 * 拉取「谷乐斯小程序」用户数据 → 为每个用户生成 docx（内容为该用户原始 API JSON 数据，不整理不筛选）→ 上传到用户知识库暂存区。
 *
 * 用法：
 *   1) 开发：确保 .env.local 有 GULESI_API_KEY（谷乐斯 API Key）、FASTGPT_FILE_LIBRARY_TOKEN（服务 Bearer token）
 *      UPLOAD_URL 缺省为 http://localhost:${APP_RUN_PORT 或 5000}
 *   2) 运行：npx tsx scripts/pull-gulesi-users.ts
 *
 * 说明：谷乐斯接口 HTTPS 证书已过期，本脚本对谷乐斯请求使用 rejectUnauthorized:false。
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { Document, Packer, Paragraph, TextRun } from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

interface GulesiBasic {
  name?: string;
  nickname?: string;
  phone?: string;
}

interface GulesiUser {
  id?: string;
  basic?: GulesiBasic;
  [key: string]: unknown;
}

interface GulesiUsersData {
  items?: GulesiUser[];
  total?: number;
}

function readEnv(name: string): string {
  // 先环境变量，再 .env.local
  if (process.env[name]) return process.env[name] as string;
  const envPath = path.join(rootDir, '.env.local');
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, 'utf8')
      .split('\n')
      .find((l) => l.trim().startsWith(`${name}=`));
    if (m) return m.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

const GULESI_KEY = readEnv('GULESI_API_KEY');
const TOKEN = readEnv('FASTGPT_FILE_LIBRARY_TOKEN');
const UPLOAD_URL = process.env.UPLOAD_URL || `http://localhost:${process.env.APP_RUN_PORT || 5000}/api/admin/user-kb/upload`;

async function fetchGulesiUsers(): Promise<GulesiUsersData> {
  if (!GULESI_KEY) throw new Error('缺少 GULESI_API_KEY，请在 .env.local 配置');
  return new Promise((resolve, reject) => {
    const url = new URL('https://api.gulesi.com/api/external/v1/users');
    url.searchParams.set('page', '1');
    url.searchParams.set('pageSize', '50');
    // 谷乐斯 HTTPS 证书已过期，rejectUnauthorized:false 跳过证书校验
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        port: 443,
        method: 'GET',
        rejectUnauthorized: false,
        headers: { 'X-API-Key': GULESI_KEY, Accept: 'application/json' },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 300) {
            reject(new Error(`谷乐斯接口 HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
            return;
          }
          try {
            const parsed = JSON.parse(body) as { data?: GulesiUsersData };
            resolve(parsed.data ?? {});
          } catch {
            reject(new Error(`谷乐斯返回非 JSON：${body.slice(0, 300)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// 直接放入谷乐斯返回的原始 JSON 数据（不整理、不筛选），保留 API 原始字段结构
async function makeDocx(user: unknown): Promise<Buffer> {
  const raw = JSON.stringify(user ?? {}, null, 2);
  const lines: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: '谷乐斯用户原始数据', bold: true, size: 36 })] }),
    new Paragraph({ text: '' }),
  ];
  for (const line of raw.split('\n')) {
    lines.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas' })] }));
  }
  const doc = new Document({ sections: [{ children: lines }] });
  return Packer.toBuffer(doc);
}

function safeName(fileName: string): string {
  return fileName.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

async function main() {
  console.log('正在拉取谷乐斯用户...');
  const data = await fetchGulesiUsers();
  const items = Array.isArray(data.items) ? data.items : [];
  const total = data.total ?? items.length;
  console.log(`拉取到用户：total=${total}，本页=${items.length}`);

  // 所有用户都生成（含 basic 为空的），docx 内放原始 JSON 数据
  const useful = items;
  console.log(`共 ${useful.length} 个用户，开始生成原始数据 docx 并上传暂存区...`);

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < useful.length; i++) {
    const u = useful[i];
    const b = u.basic ?? {};
    const fileName = safeName(`${b.name || b.nickname || '用户'}_${b.phone || u.id?.slice(0, 8)}.docx`);
    try {
      const buf = await makeDocx(u);
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(buf)]), fileName);
      const res = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
        body: fd,
      });
      const j = (await res.json()) as { success?: boolean; message?: string };
      if (j?.success) {
        ok++;
        console.log(`  [${i + 1}/${useful.length}] 已上传 ${fileName}`);
      } else {
        fail++;
        console.warn(`  [${i + 1}/${useful.length}] 上传失败 ${fileName}: ${j?.message ?? res.status}`);
      }
    } catch (e: unknown) {
      fail++;
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`  [${i + 1}/${useful.length}] 生成/上传异常 ${fileName}: ${message}`);
    }
  }

  console.log(`完成：成功 ${ok}，失败 ${fail}，共 ${useful.length}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error('拉取失败：', e instanceof Error ? e.message : String(e));
  process.exit(1);
});

