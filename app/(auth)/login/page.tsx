"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

// 정적 prerender 비활성화 — 로그인 페이지는 어차피 동적이고,
// useSearchParams + Suspense 조합이 Next 15.5에서 빌드 통과를 못하는
// 이슈를 우회하는 가장 단순한 방법.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorParam, setErrorParam] = useState<string | null>(null);

  // window.location.search로 직접 읽기 — useSearchParams 의존 제거
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setErrorParam(params.get("error"));
  }, []);

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
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
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
    </main>
  );
}
