/**
 * 헬스체크 — 셋업이 잘 됐는지 한눈에.
 * Vercel 배포 후 https://your-domain/api/health 로 검증.
 *
 * 보안: 환경변수 값은 절대 노출하지 않음. 존재 여부만 boolean으로.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    NEXT_PUBLIC_SITE_URL: !!process.env.NEXT_PUBLIC_SITE_URL,
  };

  // Supabase 연결 확인 (anon으로 가벼운 쿼리)
  let supabaseOk = false;
  let supabaseError: string | null = null;
  try {
    const supabase = await createClient();
    // profiles 테이블에 head 요청 — RLS 때문에 결과가 비어도 OK, 에러만 안 나면 연결 OK
    const { error } = await supabase.from("profiles").select("id", { count: "exact", head: true });
    supabaseOk = !error;
    if (error) supabaseError = error.message;
  } catch (e) {
    supabaseError = e instanceof Error ? e.message : "unknown";
  }

  const allEnvOk = Object.values(env).every(Boolean);

  return NextResponse.json({
    status: allEnvOk && supabaseOk ? "ok" : "partial",
    timestamp: new Date().toISOString(),
    env,
    supabase: { ok: supabaseOk, error: supabaseError },
    milestone: 1,
  });
}
