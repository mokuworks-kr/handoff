import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handoff — AI 인쇄 디자인 도구",
  description:
    "회사소개서/IR/카탈로그를 자연어로 만들고 어도비 파일로 핸드오프합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
