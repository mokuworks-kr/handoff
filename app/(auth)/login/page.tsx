"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
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
