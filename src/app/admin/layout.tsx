'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

const MENUS = [
  { href: '/admin', label: '数据看板', match: (p: string) => p === '/admin' },
  {
    href: '/admin/staging',
    label: '底层知识库管理',
    match: (p: string) => p.startsWith('/admin/staging') || p.startsWith('/admin/files'),
  },
  {
    href: '/admin/user-kb',
    label: '用户信息管理',
    match: (p: string) => p.startsWith('/admin/user-kb'),
  },
  {
    href: '/admin/chat-records',
    label: '用户聊天记录',
    match: (p: string) => p.startsWith('/admin/chat-records'),
  },
  {
    href: '/admin/docs',
    label: 'API 文档',
    match: (p: string) => p.startsWith('/admin/docs') || p.startsWith('/admin/api'),
  },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // 客户端登录态兜底：若服务端 Cookie 守卫未拦到（如跨域 iframe Cookie 失效），
  // 但在本页无 session，也强制回登录页
  useEffect(() => {
    let loggedIn = false;
    try {
      loggedIn = localStorage.getItem('kb_admin_session') === '1';
    } catch {
      // localStorage 不可用时以 Cookie 为准（服务端守卫已处理）
    }
    if (!loggedIn) {
      router.replace('/login');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLogout() {
    document.cookie = 'kb_admin_session=; path=/; max-age=0';
    try {
      localStorage.removeItem('kb_admin_session');
    } catch {
      /* ignore */
    }
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen bg-stone-100">
      {/* 左侧 Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col bg-emerald-900 text-white">
        <div className="flex h-14 items-center border-b border-emerald-800 px-5">
          <span className="text-sm font-semibold tracking-wide">
            AI 助教知识库中转站
          </span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {MENUS.map((menu) => {
            const active = menu.match(pathname);
            return (
              <Link
                key={menu.href}
                href={menu.href}
                className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-emerald-700 font-medium text-white'
                    : 'text-emerald-100 hover:bg-emerald-800 hover:text-white'
                }`}
              >
                {menu.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-emerald-800 px-5 py-4 text-xs text-emerald-200/70">
          系统 v1.0.0
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶部 Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-stone-200 bg-white px-6">
          <div className="font-mono text-sm text-stone-600">
            AI 助教知识库中转站
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="text-stone-600"
          >
            退出登录
          </Button>
        </header>

        {/* 主内容区 */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

