import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

// 旧「索引与暂存」页已迁移至后台，受登录保护。
export default function LegacyStagePage() {
  redirect('/admin/staging');
}