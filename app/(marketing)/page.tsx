import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function LandingPage() {
  // 이미 로그인했으면 대시보드로 직행
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-xl text-center space-y-6">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">Handoff</h1>
        <p className="text-ink-600 text-lg leading-relaxed">
          회사소개서/IR/카탈로그를 자연어로 만들고
          <br />
          어도비 파일로 넘기세요.
        </p>
        <div className="pt-4">
          {user ? (
            <Button asChild size="lg">
              <Link href="/dashboard">대시보드로 이동</Link>
            </Button>
          ) : (
            <Button asChild size="lg">
              <Link href="/login">시작하기</Link>
            </Button>
          )}
        </div>
        <p className="text-xs text-ink-400 pt-8">
          현재 비공개 베타 — 마일스톤 1 (인프라 + 인증)
        </p>
      </div>
    </main>
  );
}
