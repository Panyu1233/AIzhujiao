import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

// 根路径统一进入登录页；登录后由 /admin 后台接管。
export default function HomePage() {
  redirect('/login');
}