import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "마이 데스크 대시보드",
  description: "시간, 날씨, 일정, 시간표와 할 일을 한눈에 보는 개인 업무 대시보드",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
