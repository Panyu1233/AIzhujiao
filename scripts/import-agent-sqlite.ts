/**
 * 命令行导入智能体 SQLite（仅写本地存储，不写 Supabase）。
 * 用法：
 *   pnpm exec tsx scripts/import-agent-sqlite.ts users D:/Desktop/sys_conf_01.db
 *   pnpm exec tsx scripts/import-agent-sqlite.ts chats D:/Desktop/extractor.db
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  importAgentChatSqlite,
  importUnidentifiedAgentUsersSqlite,
} from '../src/lib/agent-sqlite-import';

async function main(): Promise<void> {
  const kind = process.argv[2];
  const inputPath = process.argv[3];
  if ((kind !== 'users' && kind !== 'chats') || !inputPath) {
    throw new Error('用法：tsx scripts/import-agent-sqlite.ts <users|chats> <sqlite-path>');
  }
  const absolutePath = path.resolve(inputPath);
  const buffer = await fs.readFile(absolutePath);
  const name = path.basename(absolutePath);
  const result = kind === 'users'
    ? await importUnidentifiedAgentUsersSqlite(buffer, name)
    : await importAgentChatSqlite(buffer, name);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`导入失败：${message}`);
  process.exitCode = 1;
});
