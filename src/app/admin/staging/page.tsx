'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { getAdminToken, ADMIN_SESSION_KEY } from '@/lib/admin-session';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

type FileInfo = {
  name: string;
  size: number;
  updateTime: string;
  rel: string;
  /** 仅正式库：该文件是否已存在于火山知识库 */
  inVolcano?: boolean;
  /** 仅正式库三态：'local' 本地(蓝) / 'modified' 修改(黄) / 'synced' 入库(绿) */
  syncStatus?: 'local' | 'modified' | 'synced';
};

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

export default function StagingPage() {
  const router = useRouter();
  const [activeRows, setActiveRows] = useState<FileInfo[]>([]);
  const [stagedRows, setStagedRows] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  type ConfirmLog = {
    ok: boolean;
    text: string;
  };
  /** 二次确认弹窗：含执行状态与操作日志 */
  const [confirmAction, setConfirmAction] = useState<{
    kind: 'sync' | 'restore' | 'delete';
    target: FileInfo;
    running?: boolean;
    logs?: ConfirmLog[];
    done?: boolean;
  } | null>(null);
  /** 便捷更新当前弹窗内部状态 */
  const patchConfirm = useCallback(
    (patch: Partial<NonNullable<typeof confirmAction>>) =>
      setConfirmAction((prev) => (prev ? { ...prev, ...patch } : prev)),
    [],
  );

  const auth = useCallback(() => {
    if (localStorage.getItem(ADMIN_SESSION_KEY) === '1') return getAdminToken();
    return '';
  }, []);

  async function load() {
    if (!localStorage.getItem(ADMIN_SESSION_KEY)) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/files', {
        headers: auth() ? { Authorization: `Bearer ${auth()}` } : {},
      });
      const j = await res.json();
      if (j?.success) {
        setActiveRows(j.data.active ?? []);
        setStagedRows(j.data.staged ?? []);
      } else {
        setError(j?.message || '获取文件列表失败');
      }
    } catch {
      setError('请求文件列表接口失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  

  async function confirm(row: FileInfo) {
    const t = auth();
    if (!t || busy) return;
    setBusy(row.rel);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/confirm', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${t}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename: row.rel }),
      });
      const j = await res.json();
      if (j?.success) {
        setStagedRows((prev) => prev.filter((r) => r.rel !== row.rel));
        // 同名覆盖更新 → 状态为「修改」；新增 → 「本地」
        const existed = activeRows.some((r) => r.name === row.name);
        setActiveRows((prev) => {
          const rest = prev.filter((r) => r.name !== row.name);
          return [
            ...rest,
            {
              name: row.name,
              size: row.size,
              updateTime: new Date().toISOString(),
              rel: `active/${row.name}`,
              inVolcano: existed,
              syncStatus: existed ? 'modified' : 'local',
            },
          ];
        });
        setMessage(
          existed
            ? `「${row.name}」已更新到正式库（修改，待同步到知识库）`
            : `「${row.name}」已确认上传至正式库（本地）`,
        );
      } else {
        setError(j?.message || `确认入库失败：${row.name}`);
      }
    } catch {
      setError(`请求确认接口失败：${row.name}`);
    } finally {
      setBusy(null);
    }
  }

  /** 单文件上传到火山正式知识库（只写火山，不写 Supabase） */
  async function runSyncOne(row: FileInfo) {
    const t = auth();
    if (!t || busy) return;
    setBusy(row.rel);
    const pushLog = (ok: boolean, text: string) =>
      setConfirmAction((prev) =>
        prev ? { ...prev, logs: [...(prev.logs ?? []), { ok, text }] } : prev,
      );
    try {
      pushLog(true, `开始同步「${row.name}」到火山知识库…`);
      pushLog(true, '正在校验正式库文件…');
      const res = await fetch('/api/admin/sync-to-volcano', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${t}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename: row.name }),
      });
      const j = await res.json();
      if (j?.success) {
        setActiveRows((prev) =>
          prev.map((r) =>
            r.rel === row.rel ? { ...r, inVolcano: true, syncStatus: 'synced' } : r,
          ),
        );
        pushLog(true, '正式库文件校验通过');
        pushLog(true, '已上传到火山知识库（未写 Supabase）');
        pushLog(true, `「${row.name}」同步完成`);
        setMessage(`「${row.name}」已同步到火山知识库`);
        patchConfirm({ done: true, running: false });
      } else {
        pushLog(false, `同步失败：${j?.message || '未知错误'}`);
        pushLog(false, `「${row.name}」未能同步到火山知识库`);
        patchConfirm({ done: true, running: false });
      }
    } catch {
      pushLog(false, '请求同步接口失败');
      pushLog(false, `「${row.name}」未能同步到火山知识库`);
      patchConfirm({ done: true, running: false });
    } finally {
      setBusy(null);
    }
  }

  /** 将「修改」状态的正式库文件还原为知识库当前保存的上一版内容 */
  async function runRestoreActive(row: FileInfo) {
    const t = auth();
    if (!t || busy) return;
    setBusy(row.rel);
    const pushLog = (ok: boolean, text: string) =>
      setConfirmAction((prev) =>
        prev ? { ...prev, logs: [...(prev.logs ?? []), { ok, text }] } : prev,
      );
    try {
      pushLog(true, `开始还原「${row.name}」…`);
      pushLog(true, '正在从火山知识库读取原始版本…');
      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${t}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename: row.name }),
      });
      const j = await res.json();
      if (j?.success) {
        setActiveRows((prev) =>
          prev.map((r) =>
            r.rel === row.rel
              ? {
                  ...r,
                  size: j.data?.size ?? r.size,
                  updateTime: j.data?.mtimeMs ? new Date(j.data.mtimeMs).toISOString() : new Date().toISOString(),
                  inVolcano: true,
                  syncStatus: 'synced',
                }
              : r,
          ),
        );
        pushLog(true, '已读取火山知识库中的原始文件');
        pushLog(true, `「${row.name}」已还原，状态恢复为「入库」`);
        setMessage(`「${row.name}」已还原为火山知识库中的原始版本`);
        patchConfirm({ done: true, running: false });
      } else {
        pushLog(false, `还原失败：${j?.message || '未知错误'}`);
        patchConfirm({ done: true, running: false });
      }
    } catch {
      pushLog(false, '请求还原接口失败');
      patchConfirm({ done: true, running: false });
    } finally {
      setBusy(null);
    }
  }

  /** 删除正式库文件（弹窗内执行并记录日志） */
  async function runRemoveActive(row: FileInfo) {
    const t = auth();
    if (!t || busy) return;
    setBusy(row.rel);
    const pushLog = (ok: boolean, text: string) =>
      setConfirmAction((prev) =>
        prev ? { ...prev, logs: [...(prev.logs ?? []), { ok, text }] } : prev,
      );
    try {
      pushLog(true, `开始删除「${row.name}」…`);
      const res = await fetch(
        `/api/admin/file?path=${encodeURIComponent(row.rel)}${(row.syncStatus ?? (row.inVolcano ? 'synced' : 'local')) !== 'local' ? '&remote=1' : ''}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${t}` },
        },
      );
      const j = await res.json();
      if (j?.success) {
        setActiveRows((prev) => prev.filter((r) => r.rel !== row.rel));
        pushLog(true, j.data?.remoteDeleted
          ? `已删除正式库中的「${row.name}」，并同步删除数据库和知识库中的对应数据`
          : `已删除正式库中的「${row.name}」`);
        patchConfirm({ done: true, running: false });
      } else {
        pushLog(false, `删除失败：${j?.message || '未知错误'}`);
        patchConfirm({ done: true, running: false });
      }
    } catch {
      pushLog(false, '请求删除接口失败');
      patchConfirm({ done: true, running: false });
    } finally {
      setBusy(null);
    }
  }

  /** 删除暂存文件（弹窗内执行并记录日志） */
  async function runRemoveStaged(row: FileInfo) {
    const t = auth();
    if (!t || busy) return;
    setBusy(row.rel);
    const pushLog = (ok: boolean, text: string) =>
      setConfirmAction((prev) =>
        prev ? { ...prev, logs: [...(prev.logs ?? []), { ok, text }] } : prev,
      );
    try {
      pushLog(true, `开始删除暂存文件「${row.name}」…`);
      const res = await fetch(
        `/api/admin/stage/file?rel=${encodeURIComponent(row.rel)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${t}` },
        },
      );
      const j = await res.json();
      if (j?.success) {
        setStagedRows((prev) => prev.filter((r) => r.rel !== row.rel));
        pushLog(true, `已删除暂存区中的「${row.name}」`);
        patchConfirm({ done: true, running: false });
      } else {
        pushLog(false, `删除失败：${j?.message || '未知错误'}`);
        patchConfirm({ done: true, running: false });
      }
    } catch {
      pushLog(false, '请求删除接口失败');
      patchConfirm({ done: true, running: false });
    } finally {
      setBusy(null);
    }
  }

  /** 弹窗点击「确认执行」→ 打开日志执行流程 */
  const startConfirmExec = () => {
    const act = confirmAction;
    if (!act || act.running || !act.target) return;
    patchConfirm({ running: true, logs: [], done: false });
    if (act.kind === 'sync') {
      void runSyncOne(act.target);
    } else if (act.kind === 'restore') {
      void runRestoreActive(act.target);
    } else if (act.target.rel.startsWith('active/')) {
      void runRemoveActive(act.target);
    } else {
      void runRemoveStaged(act.target);
    }
  };

  async function syncFromVolcano() {
    const t = auth();
    if (!t || syncing) return;
    setSyncing(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch(`/api/admin/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      });
      const j = await res.json();
      if (j?.success) {
        const d = j?.data ?? {};
        const failedText =
          Array.isArray(d.items) && d.failed > 0
            ? `；失败 ${d.failed} 个，原因请查看服务端日志或单文件重试`
            : '';
        const msg = d.error
          ? `同步失败：${d.error}`
          : `同步完成：已还原 ${d.restored ?? 0} 个修改文件，跳过 ${d.skipped ?? 0} 个${failedText}`;
        if (d.error) setError(msg);
        else setMessage(msg);
        // 刷新本地文件与火山文档比对结果
        await load();
      } else {
        setError(j?.message || '同步失败');
      }
    } catch {
      setError('请求同步接口失败');
    } finally {
      setSyncing(false);
    }
  }

  const RenderTable = ({
    rows,
    kind,
  }: {
    rows: FileInfo[];
    kind: 'active' | 'staged';
  }) =>
    rows.length === 0 ? (
      <div className="px-6 py-10 text-center text-sm text-stone-400">
        {loading ? '加载中...' : '暂无文件'}
      </div>
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>文件名</TableHead>
            {kind === 'active' ? <TableHead>状态</TableHead> : null}
            <TableHead>格式</TableHead>
            <TableHead>大小</TableHead>
            <TableHead>更新时间</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const name = row.name;
            const isAlsoStaged = kind === 'active' && stagedRows.some((s) => s.name === name);
            const status = row.syncStatus ?? (row.inVolcano ? 'synced' : 'local');
            return (
              <TableRow key={`${kind}-${row.rel}`}>
                <TableCell className="font-medium">{name}</TableCell>
                {kind === 'active' ? (
                  <TableCell>
                    {status === 'synced' ? (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">入库</Badge>
                    ) : status === 'modified' ? (
                      <Badge className="bg-amber-500 text-white hover:bg-amber-500">修改</Badge>
                    ) : (
                      <Badge className="bg-blue-600 text-white hover:bg-blue-600">本地</Badge>
                    )}
                  </TableCell>
                ) : null}
                <TableCell>
                  <Badge variant="secondary">{(row as { format?: string }).format || extOf(name)}</Badge>
                </TableCell>
                <TableCell className="text-stone-500">{formatBytes(row.size)}</TableCell>
                <TableCell className="text-stone-500">
                  {new Date(row.updateTime).toLocaleString('zh-CN')}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {kind === 'staged' ? (
                      <Button
                        size="sm"
                        className="bg-emerald-800 hover:bg-emerald-900"
                        disabled={busy === row.rel}
                        onClick={() => confirm(row)}
                      >
                        {busy === row.rel ? '入库中...' : '确认入库'}
                      </Button>
                    ) : null}
                    {isAlsoStaged ? (
                      <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
                        暂存有同名
                      </span>
                    ) : null}
                    {kind === 'active' && status !== 'synced' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === row.rel}
                        onClick={() => setConfirmAction({ kind: 'sync', target: row })}
                        className="text-emerald-700 hover:text-emerald-800"
                        title="同步到火山知识库（不写 Supabase）"
                      >
                        {busy === row.rel ? '同步中...' : '同步'}
                      </Button>
                    ) : null}
                    {kind === 'active' && status === 'modified' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === row.rel}
                        onClick={() => setConfirmAction({ kind: 'restore', target: row })}
                        className="text-amber-700 hover:text-amber-800"
                        title="还原为火山知识库中的原始版本"
                      >
                        还原
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === row.rel}
                      onClick={() => setConfirmAction({ kind: 'delete', target: row })}
                      className="text-red-600 hover:text-red-700"
                    >
                      删除
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">底层知识库管理</h1>
          <p className="mt-1 text-sm text-stone-500">
            暂存区和正式库都只存本地；确认入库不写外部。行内“同步”只上传到火山、不写 Supabase；顶部“同步知识库”只把“修改”文件还原为火山原版。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="bg-emerald-800 hover:bg-emerald-900"
            onClick={syncFromVolcano}
            disabled={syncing}
          >
            {syncing ? '同步中...' : '同步知识库'}
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? '加载中...' : '刷新'}
          </Button>
        </div>
      </div>

      {message ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {/* 暂存区 */}
      <div className="rounded-md border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="font-medium text-stone-800">暂存区（待审核）</span>
            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
              {stagedRows.length}
            </Badge>
          </div>
        </div>
        <RenderTable rows={stagedRows} kind="staged" />
      </div>

      {/* 正式库 */}
      <div className="rounded-md border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            <span className="font-medium text-stone-800">正式库（本地）</span>
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
              {activeRows.length}
            </Badge>
          </div>
        </div>
        <RenderTable rows={activeRows} kind="active" />
      </div>

      {/* 二次确认+执行日志弹窗：还原 / 删除 */}
      <AlertDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.kind === 'sync'
                ? '同步到火山知识库'
                : confirmAction?.kind === 'restore'
                  ? '还原到知识库版本'
                  : '删除文件'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.kind === 'sync' ? (
                <>
                  确定将「{confirmAction?.target.name}」同步到火山正式知识库吗？
                  <br />
                  只写火山知识库，不写 Supabase。若火山已有同名文档，将覆盖更新。
                </>
              ) : confirmAction?.kind === 'restore' ? (
                <>
                  确定将「{confirmAction?.target.name}」还原为火山知识库中的原始版本吗？
                  <br />
                  当前本地修改会被火山原始文件覆盖，还原后状态恢复为「入库」。
                </>
              ) : (
                <>
                  确定删除「{confirmAction?.target.name}」吗？
                  <br />
                  {confirmAction?.target.syncStatus === 'synced'
                    ? '该文件已入库，将同时删除火山知识库中的对应文档；不会访问 Supabase。'
                    : confirmAction?.target.syncStatus === 'modified'
                      ? '火山中仍有原始版本，将同时删除火山对应文档和本地文件；不会访问 Supabase。'
                      : '此操作不可恢复，请谨慎执行。'}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* 执行日志区：点击执行后展示，成功时绿色提示，失败原因红色 */}
          {confirmAction?.logs && confirmAction.logs.length > 0 ? (
            <div className="space-y-2">
              {confirmAction.logs.filter((l) => l.ok).length > 0 &&
              confirmAction.logs.every((l) => l.ok) ? (
                <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {confirmAction.kind === 'sync'
                    ? '同步完成'
                    : confirmAction.kind === 'restore'
                      ? '还原完成'
                      : '删除完成'}：{' '}
                  {confirmAction.target.name}
                </div>
              ) : null}
              <div className="max-h-48 min-w-0 space-y-1 overflow-y-auto overflow-x-hidden rounded-md border bg-stone-50 p-3 text-sm">
                {confirmAction.logs.map((l, i) => (
                  <div
                    key={i}
                    className={`min-w-0 whitespace-pre-wrap break-all font-mono text-xs ${
                      l.ok ? 'text-stone-700' : 'text-red-600'
                    }`}
                  >
                    {l.ok ? '✓' : '✗'} {l.text}
                  </div>
                ))}
              </div>
              {confirmAction.logs.some((l) => !l.ok) ? (
                <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  未执行成功，原因见上方红色日志；如需重试请关闭后重新操作。
                </div>
              ) : null}
            </div>
          ) : null}

          <AlertDialogFooter>
            {confirmAction?.done || confirmAction?.running ? (
              <AlertDialogAction
                disabled={confirmAction?.running}
                className="bg-emerald-800 text-white hover:bg-emerald-900"
                onClick={(e) => {
                  e.preventDefault();
                  setConfirmAction(null);
                }}
              >
                {confirmAction?.running ? '执行中…' : '完成'}
              </AlertDialogAction>
            ) : (
              <>
                <AlertDialogCancel className="text-stone-700">取消</AlertDialogCancel>
                <Button
                  type="button"
                  className={
                    confirmAction?.kind === 'delete'
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-emerald-800 text-white hover:bg-emerald-900'
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    startConfirmExec();
                  }}
                >
                  {confirmAction?.kind === 'sync'
                    ? '确认同步'
                    : confirmAction?.kind === 'restore'
                      ? '确认还原'
                      : '确认删除'}
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}







