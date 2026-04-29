/**
 * Google OAuth 콜백.
 * Supabase Auth가 ?code=xxx로 리다이렉트해 옴 → 세션으로 교환 → next로 이동.
 *
 * 신규 사용자라면 DB 트리거(`handle_new_user`)가 자동으로
 * profiles 행 생성 + 무료 크레딧 1,000 지급 + signup 트랜잭션 기록.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}/login?error=missing_code`);
}
