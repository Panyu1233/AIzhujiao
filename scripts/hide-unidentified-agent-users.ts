/**
 * 隐藏无法关联手机号的智能体用户 DOCX。
 *
 * 只设置 hidden 标记，不删除原始数据、DOCX 或解析结果；后续拿到
 * contact_id 与手机号映射后仍可重新显示并重命名。
 *
 * 用法：pnpm exec tsx scripts/hide-unidentified-agent-users.ts
 */
import { userKbListFiles, userKbSetHidden } from '../src/lib/user-kb-files';

async function main(): Promise<void> {
  const files = await userKbListFiles();
  const targets = files.filter((file) => file.data_source === 'unidentified_agent_user');

  for (const file of targets) {
    await userKbSetHidden(file.name, true);
  }

  const remaining = await userKbListFiles();
  console.log(JSON.stringify({
    hidden: targets.length,
    visible: remaining.length,
    visibleSources: remaining.reduce<Record<string, number>>((counts, file) => {
      const source = file.data_source || 'unmarked';
      counts[source] = (counts[source] || 0) + 1;
      return counts;
    }, {}),
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`隐藏失败：${message}`);
  process.exitCode = 1;
});
