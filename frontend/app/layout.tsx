import type { Metadata } from "next";
import "./globals.css";

const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const demoOnly = process.env.NEXT_PUBLIC_TURTLE_DEMO_ONLY === "true";

export const metadata: Metadata = {
  title: demoOnly ? "海龟汤 · 前端 Mock 演示" : "海龟汤 · 人机共游版",
  description: demoOnly
    ? "不连接后端或真实裁判、不提供真实双人同步的纯前端 Mock 演示。"
    : "让人类网页玩家与 AI 通过同一个 Session 共同游玩的海龟汤开源前端。",
  icons: {
    icon: `${publicBasePath}/favicon.svg`,
    shortcut: `${publicBasePath}/favicon.svg`,
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
