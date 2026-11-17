/**
 * 将已生成的智能体用户/聊天 DOCX 文件名统一为“显示名称_手机号”规则。
 * 无手机号时使用“显示名称_未识别手机号_来源ID”，避免同名覆盖。
 *
 * 仅重命名本地元数据，不改写 DOCX 内容和解析结果。
 * 用法：pnpm exec tsx scripts/rename-agent-docx.ts
 */
import {
  chatRecordFileGetParsed,
  chatRecordFileList,
  chatRecordFileRenameFile,
} from '../src/lib/chat-record-files';
import {
  agentChatDocxFilename,
  agentUserDocxFilename,
} from '../src/lib/user-docx';
import {
  userKbGetParsed,
  userKbListFiles,
  userKbRenameFile,
} from '../src/lib/user-kb-files';

type JsonRecord = Record<string, unknown>;

interface RenamePlan {
  oldName: string;
  newName: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsedObject(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function assertUniqueTargets(plans: RenamePlan[], currentNames: Set<string>): void {
  const targets = new Set<string>();
  const movingNames = new Set(plans.map((plan) => plan.oldName));
  for (const plan of plans) {
    if (targets.has(plan.newName)) throw new Error(`重命名目标重复：${plan.newName}`);
    if (currentNames.has(plan.newName) && !movingNames.has(plan.newName)) {
      throw new Error(`重命名目标已存在：${plan.newName}`);
    }
    targets.add(plan.newName);
  }
}

async function renameUsers(): Promise<{ renamed: number; unchanged: number }> {
  const files = await userKbListFiles({ includeHidden: true });
  const currentNames = new Set(files.map((file) => file.name));
  const plans: RenamePlan[] = [];
  let unchanged = 0;

  for (const file of files) {
    if (file.data_source !== 'unidentified_agent_user') continue;
    const parsed = parsedObject(await userKbGetParsed(file.name));
    if (parsed?.kind !== 'agent_user' || !isRecord(parsed.record)) continue;
    const newName = agentUserDocxFilename(parsed.record);
    if (newName === file.name) {
      unchanged += 1;
      continue;
    }
    plans.push({ oldName: file.name, newName });
  }

  assertUniqueTargets(plans, currentNames);
  for (const plan of plans) await userKbRenameFile(plan.oldName, plan.newName);
  return { renamed: plans.length, unchanged };
}

async function renameChats(): Promise<{ renamed: number; unchanged: number }> {
  const files = await chatRecordFileList();
  const currentNames = new Set(files.map((file) => file.name));
  const plans: RenamePlan[] = [];
  let unchanged = 0;

  for (const file of files) {
    if (file.source_type !== 'agent_sqlite') continue;
    const parsed = parsedObject(await chatRecordFileGetParsed(file.name));
    if (parsed?.kind !== 'agent_chat_user') continue;
    const senderName = typeof parsed.sender_name === 'string' ? parsed.sender_name : '';
    const senderId = typeof parsed.sender_id === 'string' ? parsed.sender_id : '';
    const phone = typeof parsed.phone === 'string' ? parsed.phone : '';
    const newName = agentChatDocxFilename(senderName, senderId, phone);
    if (newName === file.name) {
      unchanged += 1;
      continue;
    }
    plans.push({ oldName: file.name, newName });
  }

  assertUniqueTargets(plans, currentNames);
  for (const plan of plans) await chatRecordFileRenameFile(plan.oldName, plan.newName);
  return { renamed: plans.length, unchanged };
}

async function main(): Promise<void> {
  const users = await renameUsers();
  const chats = await renameChats();
  console.log(JSON.stringify({ users, chats }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`重命名失败：${message}`);
  process.exitCode = 1;
});
