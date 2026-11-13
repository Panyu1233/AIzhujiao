import fs from 'node:fs';
import path from 'node:path';

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || 'uxplkkgeutahioilsfwc';

if (!token) {
  console.error('缺少 SUPABASE_ACCESS_TOKEN。请在 Supabase 账号设置中创建 Personal Access Token 后重试。');
  process.exit(1);
}

const sqlPath = path.join(process.cwd(), 'supabase', 'migrations', '202611100001_core_schema.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'AI-Tutor-Codex',
  },
  body: JSON.stringify({ query: sql }),
});

const body = await response.text();
if (!response.ok) {
  console.error(`建表失败：HTTP ${response.status}`);
  console.error(body.slice(0, 2000));
  process.exit(1);
}

console.log(`建表 SQL 已提交：HTTP ${response.status}`);
if (body) console.log(body.slice(0, 1000));
