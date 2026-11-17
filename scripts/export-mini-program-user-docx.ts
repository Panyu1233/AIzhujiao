/**
 * 将小程序用户 DOCX 导出为普通文件夹，便于直接查看和分发。
 *
 * 只导出 gulesi_mini_program 来源，文件名保持“用户名称_手机号.docx”。
 * 不修改源记录，也不写入 Supabase。
 *
 * 用法：pnpm exec tsx scripts/export-mini-program-user-docx.ts [输出目录]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { userKbGetContent, userKbListFiles } from '../src/lib/user-kb-files';

async function main(): Promise<void> {
  const outputDir = path.resolve(
    process.argv[2] || path.join('knowledge-base', 'local-data', 'exports', 'mini-program-user-docx'),
  );
  const files = (await userKbListFiles()).filter(
    (file) => file.data_source === 'gulesi_mini_program' && file.name.toLowerCase().endsWith('.docx'),
  );

  await mkdir(outputDir, { recursive: true });

  const exported: Array<{ name: string; size: number }> = [];
  for (const file of files) {
    const content = await userKbGetContent(file.name);
    if (!content) throw new Error(`文件内容为空：${file.name}`);
    await writeFile(path.join(outputDir, file.name), content);
    exported.push({ name: file.name, size: content.length });
  }

  console.log(JSON.stringify({ outputDir, count: exported.length, files: exported }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`导出失败：${message}`);
  process.exitCode = 1;
});
