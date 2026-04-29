"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * useSearchParams() 를 호출하는 컴포넌트는 반드시 <Suspense> 안에 있어야
 * Next.js 15 production 빌드를 통과한다.
 * (없으면: "useSearchParams() should be wrapped in a suspense boundary" 에러)
 *
 * 그래서 페이지 자체는 정적 셸만 렌더하고, 실제 로그인 UI는 자식으로 분리.
 */
export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <Suspense fallback={<LoginShell />}>
        <LoginContent />
      </Suspense>
    </main>
  );
}

/** Suspense fallback — JS 로딩 전 잠깐 보이는 정적 뼈대 */
function LoginShell() {
  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-semibold">Handoff에 로그인</h1>
        <p className="text-sm text-ink-600">Google 계정으로 시작하세요</p>
      </div>
      <Button variant="outline" size="lg" className="w-full" disabled>
        Google로 계속하기
      </Button>
    </div>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (typeof window !== "undefined" ? window.location.origin : "");

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${siteUrl}/auth/callback?next=/dashboard`,
      },
    });

    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
    // 성공 시 Supabase가 외부로 redirect → 콜백 → 대시보드로 라우팅됨
  };

  const errorParam = searchParams.get("error");

  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-semibold">Handoff에 로그인</h1>
        <p className="text-sm text-ink-600">Google 계정으로 시작하세요</p>
      </div>

      <Button
        onClick={handleGoogleLogin}
        disabled={loading}
        variant="outline"
        size="lg"
        className="w-full"
      >
        {loading ? "이동 중..." : "Google로 계속하기"}
      </Button>

      {(error || errorParam) && (
        <p className="text-sm text-red-600 text-center">
          로그인에 실패했어요. {error || errorParam}
        </p>
      )}

      <p className="text-xs text-ink-400 text-center">
        가입 시 무료 크레딧 1,000이 지급됩니다.
      </p>
    </div>
  );
}
