import type { Metadata } from "next";
import "./globals.css";
import "./citizen.css";
import "./staff.css";
import "./phone.css";
import "./sai.css";

export const metadata: Metadata = {
  title: process.env.SITE_MODE==='staff'?"민원사이 · 담당자 업무": "민원사이 · 민원 신청과 상담",
  description: "민원 신청, 접수 내역 조회 및 민원 업무 관리",
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
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
