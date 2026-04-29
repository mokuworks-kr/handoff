/**
 * 미들웨어에서 호출돼 만료된 인증 토큰을 자동 갱신한다.
 * Server Component는 쿠키를 set 못하므로, 미들웨어가 navigation마다
 * 한 번씩 갱신해 둬야 다음 요청들이 유효한 세션을 본다.
 *
 * Supabase 공식 가이드 패턴:
 * https://supabase.com/docs/guides/auth/server-side/creating-a-client
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser()는 Auth 서버에 검증을 보내므로 신뢰 가능.
  // 절대 createServerClient()와 코드 사이에 다른 로직을 끼우지 말 것 — 세션이 유실됨.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 미인증 사용자가 보호 라우트에 접근하면 로그인으로 보냄.
  const path = request.nextUrl.pathname;
  const isProtected = path.startsWith("/dashboard");
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
