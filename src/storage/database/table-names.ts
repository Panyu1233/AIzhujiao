import { loadEnvLocal } from '@/lib/config';

const DEFAULT_PREFIX = 'ai_teacher_';

function normalizePrefix(value: string): string {
  const prefix = value.trim();
  if (!prefix) return '';
  if (!/^[a-z][a-z0-9_]*$/i.test(prefix)) {
    throw new Error('SUPABASE_TABLE_PREFIX 只能包含字母、数字和下划线，且必须以字母开头');
  }
  return prefix;
}

/**
 * 本项目的 Supabase 表命名空间。
 * 与其他项目共用同一 Supabase 实例时，通过专属前缀隔离表、索引和约束。
 */
export const SUPABASE_TABLE_PREFIX = normalizePrefix(
  loadEnvLocal('SUPABASE_TABLE_PREFIX') || DEFAULT_PREFIX,
);

export function tableName(name: string): string {
  return `${SUPABASE_TABLE_PREFIX}${name}`;
}