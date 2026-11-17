'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getAdminToken, ADMIN_SESSION_KEY } from '@/lib/admin-session';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

type CalibrationStats = {
  success: number;
  failed: number;
  pending: number;
};

type UserKbFile = {
  id: string;
  name: string;
  size: number;
  format?: string | null;
  content_type?: string | null;
  data_source?: string | null;
  status?: string | null;
  record_count?: number;
  ds_provider?: string | null;
  parsed_at?: string | null;
  committed_at?: string | null;
  updated_at?: string;
};

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  staging: { label: '暂存', cls: 'bg-blue-600 text-white hover:bg-blue-600' },
  parsed: { label: '正式库待上传', cls: 'bg-amber-500 text-white hover:bg-amber-500' },
  committed: { label: '已上传', cls: 'bg-emerald-600 text-white hover:bg-emerald-600' },
};

type UserDataSourceKey = 'gulesi_mini_program' | 'agent_api' | 'unidentified_agent_user';

const SOURCE_MAP: Record<UserDataSourceKey, { label: string; cls: string }> = {
  gulesi_mini_program: { label: '小程序用户', cls: 'bg-blue-100 text-blue-800 hover:bg-blue-100' },
  agent_api: { label: '智能体用户', cls: 'bg-violet-100 text-violet-800 hover:bg-violet-100' },
  unidentified_agent_user: { label: '未标识的智能体用户', cls: 'bg-stone-200 text-stone-800 hover:bg-stone-200' },
};

function sourceKeyOf(row: Pick<UserKbFile, 'data_source'>): UserDataSourceKey | null {
  return row.data_source === 'agent_api'
    || row.data_source === 'gulesi_mini_program'
    || row.data_source === 'unidentified_agent_user'
    ? row.data_source
    : null;
}

function formatBytes(n: number) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(name: string) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toUpperCase() : 'FILE';
}

const PAGE_SIZE = 10;

export default function UserKbPage() {
  const router = useRouter();
  const sqliteInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UserKbFile[]>([]);
  const [calibration, setCalibration] = useState<CalibrationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [importingSqlite, setImportingSqlite] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [selectedSource, setSelectedSource] = useState<UserDataSourceKey>('gulesi_mini_program');
  const [sourceFilter, setSourceFilter] = useState<UserDataSourceKey>('gulesi_mini_program');
  const [busyName, setBusyName] = useState<string | null>(null);
  const [batchParsing, setBatchParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1); // 用户信息正式库区分页
  const [stagePage, setStagePage] = useState(1); // 暂存区分页

  const miniFileCount = files.filter((f) => sourceKeyOf(f) === 'gulesi_mini_program').length;
  const agentFileCount = files.filter((f) => sourceKeyOf(f) === 'agent_api').length;
  const unidentifiedFileCount = files.filter((f) => sourceKeyOf(f) === 'unidentified_agent_user').length;
  const filteredFiles = files.filter((f) => sourceKeyOf(f) === sourceFilter);
  const activeSourceLabel = SOURCE_MAP[sourceFilter].label;
  const stagingFiles = filteredFiles.filter((f) => f.status === 'staging');
  const dbFiles = filteredFiles.filter((f) => f.status !== 'staging'); // parsed / committed
  const stageTotalPages = Math.max(1, Math.ceil(stagingFiles.length / PAGE_SIZE));
  const dbTotalPages = Math.max(1, Math.ceil(dbFiles.length / PAGE_SIZE));
  const safeStagePage = Math.min(stagePage, stageTotalPages);
  const safeDbPage = Math.min(page, dbTotalPages);
  const stagePageRows = stagingFiles.slice((safeStagePage - 1) * PAGE_SIZE, safeStagePage * PAGE_SIZE);
  const dbPageRows = dbFiles.slice((safeDbPage - 1) * PAGE_SIZE, safeDbPage * PAGE_SIZE);

  const auth = useCallback(() => {
    if (localStorage.getItem(ADMIN_SESSION_KEY) === '1') return getAdminToken();
    return '';
  }, []);

  const load = useCallback(async () => {
    if (!localStorage.getItem(ADMIN_SESSION_KEY)) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/user-kb/files', {
        headers: auth() ? { Authorization: `Bearer ${auth()}` } : {},
      });
      const j = await res.json();
      if (j?.success) {
        setFiles(j.data.files ?? []);
        setCalibration(j.data.calibration ?? null);
        setPage(1);
        setStagePage(1);
      } else {
        setError(j?.message || '获取用户信息文件列表失败');
      }
    } catch {
      setError('请求用户信息列表接口失败');
    } finally {
      setLoading(false);
    }
  }, [auth, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function fetchFromApi() {
    const t = auth();
    if (!t || fetching) return;
    if (!selectedSource) {
      setError('请选择数据源');
      return;
    }
    setFetching(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/user-kb/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ source: selectedSource }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) {
        setError(j?.message || `读取数据源失败（HTTP ${res.status}）`);
        return;
      }
      const created = typeof j.data?.created === 'number'
        ? j.data.created
        : typeof j.data?.count === 'number'
          ? j.data.count
          : 0;
      const updated = typeof j.data?.updated === 'number' ? j.data.updated : 0;
      const preserved = typeof j.data?.preserved === 'number' ? j.data.preserved : 0;
      const skipped = typeof j.data?.skipped === 'number' && j.data.skipped > 0
        ? `，跳过 ${j.data.skipped} 个无手机号用户`
        : '';
      const updatedText = updated > 0 ? `，更新暂存 ${updated} 个` : '';
      const preservedText = preserved > 0 ? `，保留正式库/已上传 ${preserved} 个` : '';
      setMessage(`已新增 ${created} 个用户 DOCX 到暂存区${updatedText}${preservedText}${skipped}`);
      await load();
    } catch {
      setError('读取数据源失败，请检查服务端网络与密钥配置');
    } finally {
      setFetching(false);
    }
  }

  async function importSqlite(file: File) {
    const token = auth();
    if (!token || importingSqlite) return;
    setImportingSqlite(true);
    setMessage('');
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/admin/user-kb/import-sqlite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.message || `导入 SQLite 失败（HTTP ${res.status}）`);
        return;
      }
      setSourceFilter('unidentified_agent_user');
      setPage(1);
      setStagePage(1);
      setMessage(
        `「${file.name}」已由 ${body.data.dsProvider} DS 解析：${body.data.recordCount} 个联系人，按 contact_id 拆分为 ${body.data.docxFiles} 个用户 DOCX，未写 Supabase`,
      );
      await load();
    } catch {
      setError('导入智能体 SQLite 失败，请检查 DS 配置与文件格式');
    } finally {
      setImportingSqlite(false);
      if (sqliteInputRef.current) sqliteInputRef.current.value = '';
    }
  }

  async function calibrateUsers() {
    const t = auth();
    if (!t || calibrating) return;
    if (!window.confirm('确定按手机号校准小程序用户与智能体用户吗？校准结果会写入 user_info 表。')) return;
    setCalibrating(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/user-kb/calibrate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) {
        setError(j?.message || `用户校准失败（HTTP ${res.status}）`);
        return;
      }
      setMessage(
        `校准完成：智能体用户 ${j.data.agents} 个，匹配成功 ${j.data.success} 个，校准失败 ${j.data.failed} 个。`,
      );
      await load();
    } catch {
      setError('用户校准失败，请检查数据库连接');
    } finally {
      setCalibrating(false);
    }
  }

  async function removeFile(row: UserKbFile) {
    const t = auth();
    if (!t || busyName) return;
    const remoteHint = row.status === 'committed'
      ? '\n该文件已上传数据库，删除时会同时删除数据库中的对应用户记录。'
      : '';
    if (!window.confirm(`确定从用户信息管理删除「${row.name}」吗？此操作不可恢复。${remoteHint}`)) return;
    setBusyName(row.name);
    setMessage('');
    setError('');
    try {
      const res = await fetch(
        `/api/admin/user-kb/file?name=${encodeURIComponent(row.name)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } },
      );
      const j = await res.json();
      if (j?.success) {
        setFiles((prev) => prev.filter((f) => f.name !== row.name));
        setMessage(j.data?.remoteDeleted
          ? `已删除「${row.name}」，并删除数据库中的对应用户记录`
          : `已删除「${row.name}」`);
      } else {
        setError(j?.message || `删除失败：${row.name}`);
      }
    } catch {
      setError('请求删除接口失败');
    } finally {
      setBusyName(null);
    }
  }

  async function openFile(row: UserKbFile, download = false) {
    const token = auth();
    if (!token) return;
    setMessage('');
    setError('');

    if (download) {
      try {
        const res = await fetch(
          `/api/admin/user-kb/download?name=${encodeURIComponent(row.name)}&download=1`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.message || `获取文件失败（HTTP ${res.status}）`);
          return;
        }
        const url = window.URL.createObjectURL(await res.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = row.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => window.URL.revokeObjectURL(url), 10000);
      } catch {
        setError('获取文件失败，请重试');
      }
      return;
    }

    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      setError('浏览器拦截了预览窗口，请允许弹出窗口后重试');
      return;
    }
    previewWindow.document.write('<!doctype html><meta charset="utf-8"><title>正在加载预览</title><p style="font:14px sans-serif;padding:24px;color:#57534e">正在生成在线预览...</p>');

    try {
      const res = await fetch(
        `/api/admin/user-kb/preview?name=${encodeURIComponent(row.name)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        previewWindow.close();
        setError(body?.message || `生成预览失败（HTTP ${res.status}）`);
        return;
      }
      const html = await res.text();
      previewWindow.document.open();
      previewWindow.document.write(html);
      previewWindow.document.close();
    } catch {
      previewWindow.close();
      setError('生成文件预览失败，请重试');
    }
  }

  async function parseFile(row: UserKbFile) {
    const t = auth();
    if (!t || busyName) return;
    setBusyName(row.name);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/user-kb/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ name: row.name }),
      });
      const j = await res.json();
      if (j?.success) {
        setMessage(`「${row.name}」解析完成，已进入用户信息正式库区`);
        await load();
      } else {
        setError(j?.message || `解析失败：${row.name}`);
      }
    } catch {
      setError(`请求解析接口失败：${row.name}`);
    } finally {
      setBusyName(null);
    }
  }

  async function parseAllStaged() {
    const t = auth();
    if (!t || batchParsing || busyName) return;
    const targets = stagingFiles.filter((row) => (row.status || 'staging') === 'staging');
    if (targets.length === 0) {
      setMessage('当前来源没有待解析的暂存文件');
      return;
    }
    if (!window.confirm(`确定批量解析「${activeSourceLabel}」暂存区的 ${targets.length} 个文件吗？`)) return;

    setBatchParsing(true);
    setParseProgress({ done: 0, total: targets.length });
    setMessage('');
    setError('');
    let parsed = 0;
    const failures: string[] = [];

    try {
      for (let index = 0; index < targets.length; index += 1) {
        const row = targets[index];
        setBusyName(row.name);
        try {
          const res = await fetch('/api/admin/user-kb/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
            body: JSON.stringify({ name: row.name }),
          });
          const j = await res.json().catch(() => null);
          if (res.ok && j?.success) {
            parsed += 1;
          } else {
            failures.push(`${row.name}：${j?.message || `HTTP ${res.status}`}`);
          }
        } catch {
          failures.push(`${row.name}：请求解析接口失败`);
        } finally {
          setParseProgress({ done: index + 1, total: targets.length });
        }
      }

      await load();
      if (failures.length > 0) {
        setMessage(`批量解析完成：成功 ${parsed} 个，失败 ${failures.length} 个`);
        setError(`失败文件：${failures.join('；')}`);
      } else {
        setMessage(`批量解析完成：${parsed} 个文件已进入用户信息正式库区`);
      }
    } finally {
      setBusyName(null);
      setBatchParsing(false);
    }
  }

  async function commitFile(row: UserKbFile) {
    const t = auth();
    if (!t || busyName) return;
    setBusyName(row.name);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/user-kb/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ name: row.name }),
      });
      const j = await res.json();
      if (j?.success) {
        const table = j.data?.table ? ` ${j.data.table}` : '';
        setMessage(`「${row.name}」已上传数据库${table}（状态：已上传数据库）`);
        await load();
      } else {
        setError(j?.message || `上传数据库失败：${row.name}`);
      }
    } catch {
      setError(`请求上传数据库接口失败：${row.name}`);
    } finally {
      setBusyName(null);
    }
  }

  const stageBytes = stagingFiles.reduce((s, f) => s + (f.size || 0), 0);
  const dbBytes = dbFiles.reduce((s, f) => s + (f.size || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">用户信息管理</h1>
          <p className="mt-1 text-sm text-stone-500">
            DOCX/API 数据先进入暂存区；智能体 SQLite 可直接导入并由 DS 解析，保存到“未标识的智能体用户”。所有数据先落本地，暂不写 Supabase。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={sqliteInputRef}
            type="file"
            accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importSqlite(file);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="border-stone-300"
            disabled={importingSqlite}
            onClick={() => sqliteInputRef.current?.click()}
          >
            {importingSqlite ? 'DS 解析中...' : '导入智能体 SQLite'}
          </Button>
          <Button
            size="sm"
            className="bg-emerald-800 text-white hover:bg-emerald-900"
            onClick={() => void calibrateUsers()}
            disabled={calibrating}
          >
            {calibrating ? '校准中...' : '校准'}
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? '加载中...' : '刷新'}
          </Button>
        </div>
      </div>

      <div className="rounded-md border bg-white p-4">
        <label htmlFor="user-kb-source" className="text-sm font-medium text-stone-700">
          用户数据源
        </label>
        <p className="mt-1 text-xs text-stone-500">
          通过服务端密钥读取外部数据，浏览器不会接触 API Key。数据先进入暂存区，确认后才进入正式库。
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            id="user-kb-source"
            value={selectedSource}
            onChange={(event) => setSelectedSource(event.target.value as UserDataSourceKey)}
            className="h-9 flex-1 rounded-md border border-stone-200 bg-white px-3 text-sm text-stone-800 outline-none focus:border-emerald-700"
          >
            <option value="gulesi_mini_program">谷乐斯小程序用户数据（全字段）</option>
            <option value="agent_api">智能体用户数据</option>
          </select>
          <Button
            size="sm"
            className="bg-emerald-800 text-white hover:bg-emerald-900"
            disabled={fetching || !selectedSource}
            onClick={() => void fetchFromApi()}
          >
            {fetching ? '读取中...' : '读取到暂存区'}
          </Button>
        </div>
      </div>

      {message ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="flex flex-col gap-3 rounded-md border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-stone-700">按来源查看</p>
          <p className="mt-1 text-xs text-stone-500">小程序和智能体数据互不混排，源文件均保存在本地。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={sourceFilter === 'gulesi_mini_program' ? 'default' : 'outline'}
            className={sourceFilter === 'gulesi_mini_program' ? 'bg-blue-600 text-white hover:bg-blue-700' : ''}
            onClick={() => {
              setSourceFilter('gulesi_mini_program');
              setPage(1);
              setStagePage(1);
            }}
          >
            小程序用户 {miniFileCount}
          </Button>
          <Button
            size="sm"
            variant={sourceFilter === 'agent_api' ? 'default' : 'outline'}
            className={sourceFilter === 'agent_api' ? 'bg-violet-600 text-white hover:bg-violet-700' : ''}
            onClick={() => {
              setSourceFilter('agent_api');
              setPage(1);
              setStagePage(1);
            }}
          >
            智能体用户 {agentFileCount}
          </Button>
          <Button
            size="sm"
            variant={sourceFilter === 'unidentified_agent_user' ? 'default' : 'outline'}
            className={sourceFilter === 'unidentified_agent_user' ? 'bg-stone-700 text-white hover:bg-stone-800' : ''}
            onClick={() => {
              setSourceFilter('unidentified_agent_user');
              setPage(1);
              setStagePage(1);
            }}
          >
            未标识的智能体用户 {unidentifiedFileCount}
          </Button>
        </div>
      </div>

      {/* 统计信息 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">暂存区文件</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-semibold tracking-tight text-stone-800">
              {loading ? '—' : stagingFiles.length}
            </span>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">用户信息正式库</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-semibold tracking-tight text-stone-800">
              {loading ? '—' : dbFiles.length}
            </span>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">存储位置</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-sm font-medium text-stone-700">本地 knowledge-base/local-data</span>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">校准结果</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                成功 {loading ? '—' : calibration?.success ?? 0}
              </Badge>
              <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                失败 {loading ? '—' : calibration?.failed ?? 0}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 暂存区：原始 docx */}
      <div className="rounded-md border bg-white">
        <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="font-medium text-stone-800">暂存区 · {activeSourceLabel}</span>
            <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">{stagingFiles.length}</Badge>
            <span className="text-xs text-stone-400">{formatBytes(stageBytes)}</span>
          </div>
          <Button
            size="sm"
            className="bg-amber-600 text-white hover:bg-amber-700"
            disabled={batchParsing || !!busyName || stagingFiles.length === 0}
            onClick={() => void parseAllStaged()}
          >
            {batchParsing
              ? `批量解析中 ${parseProgress.done}/${parseProgress.total}`
              : `批量解析（${stagingFiles.length}）`}
          </Button>
        </div>
        {stagingFiles.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-stone-400">
            {loading ? '加载中...' : '暂存区暂无文件'}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件名</TableHead>
                <TableHead>数据源</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>格式</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stagePageRows.map((row) => (
                <TableRow key={`s-${row.id}-${row.name}`}>
                  <TableCell className="font-medium">
                    {row.name}
                    {row.record_count ? <span className="ml-2 text-xs text-stone-400">{row.record_count.toLocaleString('zh-CN')} 条</span> : null}
                    {row.ds_provider ? <span className="ml-2 text-xs text-stone-400">{row.ds_provider.toUpperCase()} 已解析</span> : null}
                  </TableCell>
                  <TableCell>
                    {sourceKeyOf(row) ? (
                      <Badge className={SOURCE_MAP[sourceKeyOf(row)!].cls}>{SOURCE_MAP[sourceKeyOf(row)!].label}</Badge>
                    ) : (
                      <Badge variant="secondary">来源未标记</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={(STATUS_MAP[row.status || 'staging'] || STATUS_MAP.staging).cls}>
                      {(STATUS_MAP[row.status || 'staging'] || STATUS_MAP.staging).label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{row.format || extOf(row.name)}</Badge>
                  </TableCell>
                  <TableCell className="text-stone-500">{formatBytes(row.size)}</TableCell>
                  <TableCell className="text-stone-500">
                    {row.updated_at ? new Date(row.updated_at).toLocaleString('zh-CN') : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={batchParsing || busyName === row.name}
                        onClick={() => parseFile(row)}
                        className="text-amber-600 hover:text-amber-700"
                      >
                        {busyName === row.name ? '解析中...' : '解析'}
                      </Button>
                      <Button size="sm" variant="outline" className="text-emerald-700 hover:text-emerald-800" onClick={() => openFile(row)}>
                        查看
                      </Button>
                      <Button size="sm" variant="outline" className="text-emerald-700 hover:text-emerald-800" onClick={() => openFile(row, true)}>
                        下载
                      </Button>
                      <Button size="sm" variant="outline" disabled={busyName === row.name} onClick={() => removeFile(row)} className="text-red-600 hover:text-red-700">
                        {busyName === row.name ? '删除中...' : '删除'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {stageTotalPages > 1 ? (
          <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
            <Button size="sm" variant="outline" disabled={safeStagePage <= 1} onClick={() => setStagePage((p) => p - 1)}>
              上一页
            </Button>
            <span className="text-sm text-stone-500">
              {safeStagePage} / {stageTotalPages}
            </span>
            <Button size="sm" variant="outline" disabled={safeStagePage >= stageTotalPages} onClick={() => setStagePage((p) => p + 1)}>
              下一页
            </Button>
          </div>
        ) : null}
      </div>

      {/* 用户信息正式库区：解析生成的 xlsx */}
      <div className="rounded-md border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            <span className="font-medium text-stone-800">用户信息正式库区 · {activeSourceLabel}</span>
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{dbFiles.length}</Badge>
            <span className="text-xs text-stone-400">{formatBytes(dbBytes)}</span>
          </div>
        </div>
        {dbFiles.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-stone-400">
            {loading ? '加载中...' : '暂无文件，请先在暂存区点击「解析」'}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件名</TableHead>
                <TableHead>数据源</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>格式</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dbPageRows.map((row) => (
                <TableRow key={`d-${row.id}-${row.name}`}>
                  <TableCell className="font-medium">
                    {row.name}
                    {row.record_count ? <span className="ml-2 text-xs text-stone-400">{row.record_count.toLocaleString('zh-CN')} 条</span> : null}
                    {row.ds_provider ? <span className="ml-2 text-xs text-stone-400">{row.ds_provider.toUpperCase()} 已解析</span> : null}
                  </TableCell>
                  <TableCell>
                    {sourceKeyOf(row) ? (
                      <Badge className={SOURCE_MAP[sourceKeyOf(row)!].cls}>{SOURCE_MAP[sourceKeyOf(row)!].label}</Badge>
                    ) : (
                      <Badge variant="secondary">来源未标记</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_MAP[row.status || 'parsed'].cls}>
                      {STATUS_MAP[row.status || 'parsed'].label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{row.format || extOf(row.name)}</Badge>
                  </TableCell>
                  <TableCell className="text-stone-500">{formatBytes(row.size)}</TableCell>
                  <TableCell className="text-stone-500">
                    {row.updated_at ? new Date(row.updated_at).toLocaleString('zh-CN') : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyName === row.name || row.status === 'committed' || sourceKeyOf(row) === 'unidentified_agent_user'}
                        onClick={() => commitFile(row)}
                        className="text-emerald-700 hover:text-emerald-800"
                      >
                        {busyName === row.name
                          ? '上传中...'
                          : row.status === 'committed'
                            ? '已上传'
                            : sourceKeyOf(row) === 'unidentified_agent_user'
                              ? '待字段映射'
                              : '上传数据库'}
                      </Button>
                      <Button size="sm" variant="outline" className="text-emerald-700 hover:text-emerald-800" onClick={() => openFile(row)}>
                        查看
                      </Button>
                      <Button size="sm" variant="outline" className="text-emerald-700 hover:text-emerald-800" onClick={() => openFile(row, true)}>
                        下载
                      </Button>
                      <Button size="sm" variant="outline" disabled={busyName === row.name} onClick={() => removeFile(row)} className="text-red-600 hover:text-red-700">
                        {busyName === row.name ? '删除中...' : '删除'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {dbTotalPages > 1 ? (
          <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
            <Button size="sm" variant="outline" disabled={safeDbPage <= 1} onClick={() => setPage((p) => p - 1)}>
              上一页
            </Button>
            <span className="text-sm text-stone-500">
              {safeDbPage} / {dbTotalPages}
            </span>
            <Button size="sm" variant="outline" disabled={safeDbPage >= dbTotalPages} onClick={() => setPage((p) => p + 1)}>
              下一页
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

