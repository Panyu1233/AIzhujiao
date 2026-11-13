import { createHash } from 'node:crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config';

export interface LocalJsonRecord {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

function assertNamespace(namespace: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(namespace)) {
    throw new Error('本地文件存储命名空间不合法');
  }
  return namespace;
}

function storeRoot(namespace: string): string {
  return path.join(config.localDataRoot, assertNamespace(namespace));
}

function recordId(name: string): string {
  return createHash('sha256').update(name).digest('hex').slice(0, 40);
}

function recordPath(namespace: string, name: string): string {
  return path.join(storeRoot(namespace), `${recordId(name)}.json`);
}

async function ensureStore(namespace: string): Promise<string> {
  const root = storeRoot(namespace);
  await fs.mkdir(root, { recursive: true });
  return root;
}

export async function localListRecords<T extends LocalJsonRecord>(namespace: string): Promise<T[]> {
  const root = await ensureStore(namespace);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const records: T[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(root, entry.name), 'utf8');
      const record = JSON.parse(raw) as T;
      if (record && typeof record.name === 'string') records.push(record);
    } catch {
      // 单个损坏文件不影响其他记录。
    }
  }
  return records.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function localGetRecord<T extends LocalJsonRecord>(
  namespace: string,
  name: string,
): Promise<T | null> {
  await ensureStore(namespace);
  try {
    const raw = await fs.readFile(recordPath(namespace, name), 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function localPutRecord<T extends LocalJsonRecord>(
  namespace: string,
  record: T,
): Promise<T> {
  await ensureStore(namespace);
  const serialized = JSON.stringify(record, null, 2);
  const target = recordPath(namespace, record.name);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, serialized, 'utf8');
  await fs.rename(temp, target);
  return record;
}

export async function localUpdateRecord<T extends LocalJsonRecord>(
  namespace: string,
  name: string,
  updater: (record: T) => T | Promise<T>,
): Promise<T | null> {
  const existing = await localGetRecord<T>(namespace, name);
  if (!existing) return null;
  const updated = await updater(existing);
  return localPutRecord(namespace, updated);
}

export async function localDeleteRecord(namespace: string, name: string): Promise<boolean> {
  await ensureStore(namespace);
  try {
    await fs.unlink(recordPath(namespace, name));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function localNewRecordId(name: string): string {
  return recordId(name);
}