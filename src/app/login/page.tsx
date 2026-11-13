'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { setAdminToken } from '@/lib/admin-session';

export default function LoginPage() {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.message || '账号或密码错误');
        return;
      }

      try {
        localStorage.setItem('kb_admin_session', '1');
        setAdminToken(String(body.data?.token || 'kb-admin'));
      } catch {
        /* localStorage 被禁时仍尝试 Cookie */
      }
      try {
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `kb_admin_session=1; path=/; max-age=3600; SameSite=Lax${secure}`;
      } catch {
        /* 跨域 iframe 下 Cookie 可能写不进，不影响 localStorage 守卫 */
      }
      window.location.href = '/admin';
    } catch {
      setError('登录请求失败，请检查网络');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <Card className="w-full max-w-sm shadow-sm">
        <CardHeader className="text-center">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-800">
            AI 助教知识库中转站
          </p>
          <CardTitle className="mt-2 text-xl font-semibold tracking-tight text-stone-800">
            后台登录
          </CardTitle>
          <CardDescription className="text-stone-500">
            请输入账号密码进入管理系统
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="account">账号</Label>
              <Input
                id="account"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="admin@aizhujiao"
                autoComplete="username"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="admin123"
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full bg-emerald-800 hover:bg-emerald-900">
              {loading ? '登录中…' : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
