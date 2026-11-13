'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getAdminToken, ADMIN_SESSION_KEY } from '@/lib/admin-session';

type Stats = {
  activeCount: number;
  stagedCount: number;
  todayCalls: number;
  volcanoStatus: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!localStorage.getItem(ADMIN_SESSION_KEY)) {
      router.replace('/login');
      return;
    }
    const token = getAdminToken();
    fetch('/api/admin/stats', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) setStats(j.data);
        else setError(j?.message || '获取统计数据失败');
      })
      .catch(() => setError('请求统计接口失败'));
  }, [router]);

  const metrics = [
    { label: '正式库文件总数', value: stats ? String(stats.activeCount) : '—', hint: '已审核入库的正式知识文件' },
    { label: '暂存区文件数', value: stats ? String(stats.stagedCount) : '—', hint: '等待确认入库的文件' },
    { label: '今日调用次数', value: stats ? String(stats.todayCalls) : '—', hint: 'FastGPT 拉取接口调用量' },
    { label: '火山同步状态', value: stats ? (stats.volcanoStatus === 'normal' ? '正常' : '异常') : '—', hint: '同步火山知识库', ok: stats?.volcanoStatus === 'normal' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-800">数据看板</h1>
        <p className="mt-1 text-sm text-stone-500">
          知识库中转站核心运行指标（来自后端真实统计）
        </p>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.label} className="bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-stone-500">
                {m.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight text-stone-800">
                  {m.value}
                </span>
                {m.ok !== undefined ? (
                  <Badge
                    className={
                      m.ok
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
                        : 'bg-red-100 text-red-800 hover:bg-red-100'
                    }
                  >
                    {m.value}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-stone-400">{m.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}