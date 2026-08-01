import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "海龟汤 · 人机共游版",
  description: "让人类网页玩家与 AI 通过同一个 Session 共同游玩的海龟汤开源前端。",
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
