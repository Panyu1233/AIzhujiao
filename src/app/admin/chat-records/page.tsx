'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ADMIN_SESSION_KEY, getAdminToken } from '@/lib/admin-session';

type ChatRecordFile = {
  id: string;
  name: string;
  size: number;
  format?: string | null;
  content_type?: string | null;
  status: 'staging' | 'formal' | 'committed' | string;
  source_type?: string | null;
  source_url?: string | null;
  record_count: number;
  confirmed_at?: string | null;
  committed_at?: string | null;
  updated_at?: string;
};

type ChatFileStats = {
  staging: number;
  formal: number;
  committed: number;
  total: number;
  totalBytes: number;
};

const PAGE_SIZE = 10;

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  staging: { label: '暂存', cls: 'bg-blue-600 text-white hover:bg-blue-600' },
  formal: { label: '正式库待上传', cls: 'bg-amber-500 text-white hover:bg-amber-500' },
  committed: { label: '已上传数据库', cls: 'bg-emerald-600 text-white hover:bg-emerald-600' },
};

function formatBytes(n: number) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

export default function ChatRecordsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ChatRecordFile[]>([]);
  const [stats, setStats] = useState<ChatFileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [selectedSource, setSelectedSource] = useState('agent_chat_api');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [stagePage, setStagePage] = useState(1);
  const [formalPage, setFormalPage] = useState(1);

  const stagingFiles = files.filter((f) => f.status === 'staging');
  const formalFiles = files.filter((f) => f.status === 'formal' || f.status === 'committed');
  const stageTotalPages = Math.max(1, Math.ceil(stagingFiles.length / PAGE_SIZE));
  const formalTotalPages = Math.max(1, Math.ceil(formalFiles.length / PAGE_SIZE));
  const safeStagePage = Math.min(stagePage, stageTotalPages);
  const safeFormalPage = Math.min(formalPage, formalTotalPages);
  const stageRows = stagingFiles.slice((safeStagePage - 1) * PAGE_SIZE, safeStagePage * PAGE_SIZE);
  const formalRows = formalFiles.slice((safeFormalPage - 1) * PAGE_SIZE, safeFormalPage * PAGE_SIZE);

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
      const token = auth();
      const res = await fetch('/api/admin/chat-records/files', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.message || `获取聊天记录文件失败（HTTP ${res.status}）`);
        return;
      }
      setFiles(body.data.files ?? []);
      setStats(body.data.stats ?? null);
      setStagePage(1);
      setFormalPage(1);
    } catch {
      setError('请求聊天记录文件接口失败');
    } finally {
      setLoading(false);
    }
  }, [auth, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadFile(file: File) {
    const token = auth();
    if (!token || uploading) return;
    setUploading(true);
    setMessage('');
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/admin/chat-records/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.message || `上传暂存区失败（HTTP ${res.status}）`);
        return;
      }
      setMessage(`「${file.name}」已进入暂存区`);
      await load();
    } catch {
      setError('上传聊天记录 JSON 失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function fetchFromApi() {
    const token = auth();
    if (!token || fetching) return;
    if (!selectedSource) {
      setError('请选择数据源');
      return;
    }
    setFetching(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/chat-records/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ source: selectedSource }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.message || `读取聊天记录 API 失败（HTTP ${res.status}）`);
        return;
      }
      setMessage(`聊天记录已进入暂存区：「${body.data.name}」，共 ${body.data.record_count} 条`);
      await load();
    } catch {
      setError('读取聊天记录 API 失败，请检查服务端网络与密钥配置');
    } finally {
      setFetching(false);
    }
  }

  async function confirmFile(row: ChatRecordFile) {
    const token = auth();
    if (!token || busyName) return;
    setBusyName(row.name);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/chat-records/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: row.name }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.message || `确认正式库失败：${row.name}`);
        return;
      }
      setMessage(`「${row.name}」已确认到正式库，尚未写入 chat_message`);
      await load();
    } catch {
      setError(`请求确认接口失败：${row.name}`);
    } finally {
      setBusyName(null);
    }
  }

  async function commitFile(row: ChatRecordFile) {
    const token = auth();
    if (!token || busyName) return;
    setBusyName(row.name);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/chat-records/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: row.name }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.message || `上传数据库失败：${row.name}`);
        return;
      }
      setMessage(`「${row.name}」已上传到 ai_teacher_chat_message：${body.data.inserted} 条`);
      await load();
    } catch {
      setError(`请求上传数据库接口失败：${row.name}`);
    } finally {
      setBusyName(null);
    }
  }

  async function openFile(row: ChatRecordFile, download = false) {
    const token = auth();
    if (!token) return;
    setMessage('');
    setError('');
    try {
      const res = await fetch(
        `/api/admin/chat-records/content?name=${encodeURIComponent(row.name)}${download ? '&download=1' : ''}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message || `读取文件失败（HTTP ${res.status}）`);
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement('a');
        link.href = url;
        link.download = row.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else {
        window.open(url, '_blank');
      }
      setTimeout(() => window.URL.revokeObjectURL(url), 10000);
    } catch {
      setError('读取聊天记录文件失败，请重试');
    }
  }

  async function removeFile(row: ChatRecordFile) {
    const token = auth();
    if (!token || busyName) return;
    const remoteHint = row.status === 'committed'
      ? '\n该文件已上传数据库，删除时会同时删除 chat_message 中对应的聊天记录。'
      : '';
    if (!window.confirm(`确定删除聊天记录文件「${row.name}」吗？此操作不可恢复。${remoteHint}`)) return;
    setBusyName(row.name);
    setMessage('');
    setError('');
    try {
      const res = await fetch(`/api/admin/chat-records/file?name=${encodeURIComponent(row.name)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.message || `删除失败：${row.name}`);
        return;
      }
      setMessage(body.data?.remoteDeleted
        ? `已删除「${row.name}」，并删除数据库中的 ${body.data.deleted} 条聊天记录`
        : `已删除「${row.name}」`);
      await load();
    } catch {
      setError('请求删除接口失败');
    } finally {
      setBusyName(null);
    }
  }

  function renderRows(rows: ChatRecordFile[], mode: 'staging' | 'formal') {
    return rows.map((row) => (
      <TableRow key={`${mode}-${row.id}`}>
        <TableCell className="font-medium">{row.name}</TableCell>
        <TableCell>
          <Badge className={STATUS_MAP[row.status]?.cls || ''}>
            {STATUS_MAP[row.status]?.label || row.status}
          </Badge>
        </TableCell>
        <TableCell className="text-stone-600">{row.record_count.toLocaleString('zh-CN')} 条</TableCell>
        <TableCell className="text-stone-500">{formatBytes(row.size)}</TableCell>
        <TableCell className="text-stone-500">{formatTime(row.updated_at)}</TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-2">
            {mode === 'staging' ? (
              <Button
                size="sm"
                variant="outline"
                className="text-amber-700 hover:text-amber-800"
                disabled={busyName === row.name}
                onClick={() => void confirmFile(row)}
              >
                {busyName === row.name ? '确认中...' : '确认正式库'}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="text-emerald-700 hover:text-emerald-800"
                disabled={busyName === row.name || row.status === 'committed'}
                onClick={() => void commitFile(row)}
              >
                {busyName === row.name
                  ? '上传中...'
                  : row.status === 'committed'
                    ? '已上传数据库'
                    : '上传数据库'}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void openFile(row)}>
              查看
            </Button>
            <Button size="sm" variant="outline" onClick={() => void openFile(row, true)}>
              下载
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 hover:text-red-700"
              disabled={busyName === row.name}
              onClick={() => void removeFile(row)}
            >
              删除
            </Button>
          </div>
        </TableCell>
      </TableRow>
    ));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">用户聊天记录</h1>
          <p className="mt-1 text-sm text-stone-500">
            外部 API 先进入暂存区，确认后进入正式库；只有点击“上传数据库”才会写入 ai_teacher_chat_message。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
          <Button
            size="sm"
            className="bg-emerald-800 text-white hover:bg-emerald-900"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? '上传中...' : '上传 JSON 到暂存区'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? '加载中...' : '刷新'}
          </Button>
        </div>
      </div>

      <div className="rounded-md border bg-white p-4">
        <label htmlFor="chat-source" className="text-sm font-medium text-stone-700">
          聊天记录数据源
        </label>
        <p className="mt-1 text-xs text-stone-500">
          当前只接入智能体聊天记录 API；地址与密钥由服务端环境变量配置，读取后先进入暂存区。
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            id="chat-source"
            value={selectedSource}
            onChange={(event) => setSelectedSource(event.target.value)}
            className="h-9 flex-1 rounded-md border border-stone-200 bg-white px-3 text-sm text-stone-800 outline-none focus:border-emerald-700"
          >
            <option value="agent_chat_api">智能体聊天记录 API</option>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">暂存区文件</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-semibold tracking-tight text-blue-700">
              {loading ? '—' : stagingFiles.length}
            </span>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">正式库待上传</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-semibold tracking-tight text-amber-700">
              {loading ? '—' : formalFiles.filter((f) => f.status === 'formal').length}
            </span>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">已上传数据库</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-semibold tracking-tight text-emerald-700">
              {loading ? '—' : stats?.committed ?? 0}
            </span>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">文件总量</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-xl font-semibold tracking-tight text-stone-800">
              {loading ? '—' : `${stats?.total ?? 0} 个 / ${formatBytes(stats?.totalBytes ?? 0)}`}
            </span>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="font-medium text-stone-800">暂存区（外部 API 待确认）</span>
            <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">{stagingFiles.length}</Badge>
          </div>
          <span className="text-xs text-stone-400">确认后进入正式库，不写入 chat_message</span>
        </div>
        {stagingFiles.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-stone-400">
            {loading ? '加载中...' : '暂存区暂无聊天记录文件，可通过接口或右上角上传 JSON'}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件名</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>记录数</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>{renderRows(stageRows, 'staging')}</TableBody>
          </Table>
        )}
        {stageTotalPages > 1 ? (
          <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
            <Button size="sm" variant="outline" disabled={safeStagePage <= 1} onClick={() => setStagePage((p) => p - 1)}>
              上一页
            </Button>
            <span className="text-sm text-stone-500">{safeStagePage} / {stageTotalPages}</span>
            <Button size="sm" variant="outline" disabled={safeStagePage >= stageTotalPages} onClick={() => setStagePage((p) => p + 1)}>
              下一页
            </Button>
          </div>
        ) : null}
      </div>

      <div className="rounded-md border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            <span className="font-medium text-stone-800">用户聊天记录正式库</span>
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{formalFiles.length}</Badge>
          </div>
          <span className="text-xs text-stone-400">点击“上传数据库”才写入 chat_message</span>
        </div>
        {formalFiles.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-stone-400">
            {loading ? '加载中...' : '正式库暂无文件，请先在暂存区确认'}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件名</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>记录数</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>{renderRows(formalRows, 'formal')}</TableBody>
          </Table>
        )}
        {formalTotalPages > 1 ? (
          <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
            <Button size="sm" variant="outline" disabled={safeFormalPage <= 1} onClick={() => setFormalPage((p) => p - 1)}>
              上一页
            </Button>
            <span className="text-sm text-stone-500">{safeFormalPage} / {formalTotalPages}</span>
            <Button size="sm" variant="outline" disabled={safeFormalPage >= formalTotalPages} onClick={() => setFormalPage((p) => p + 1)}>
              下一页
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

