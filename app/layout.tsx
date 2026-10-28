import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "海龟汤 · 人机共游版",
  description: "由 ChatGPT Sites 托管、网页与 MCP 共享进度的海龟汤 Mock 全栈演示。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
