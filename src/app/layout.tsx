import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '知识库文件 API 服务',
  description:
    '为 FastGPT API 文件库提供文件树、文件内容、阅读链接与文件详情接口的知识库文件服务。',
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
