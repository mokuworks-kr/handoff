/**
 * Server Component / Route Handler / Server Action에서 쓰는 Supabase 클라이언트.
 *
 * Next.js 15에서 `cookies()`가 async가 됐으므로 이 함수도 async.
 * 반드시 `getAll`/`setAll` 패턴만 사용 — `get`/`set` 단일 쿠키 패턴은
 * @supabase/ssr 0.5+ 에서 deprecated 되어 인증 세션이 깨진다.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component에서 호출되면 set이 throw — 미들웨어가 갱신을 처리하므로 무시.
          }
        },
      },
    },
  );
}
