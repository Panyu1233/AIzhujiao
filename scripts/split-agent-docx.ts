/**
 * 离线把已完成的智能体 DS 解析结果拆成一用户一个 DOCX。
 * 不重新调用 DS，不读取 SQLite，不写 Supabase。
 *
 * 用法：pnpm exec tsx scripts/split-agent-docx.ts
 */
import { splitAgentDocx } from '../src/lib/agent-docx-split';

async function main(): Promise<void> {
  const result = await splitAgentDocx({
    onProgress: (message) => console.log(message),
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`拆分失败：${message}`);
  process.exitCode = 1;
});