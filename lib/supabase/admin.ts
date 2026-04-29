/**
 * service_role 키로 RLS를 우회하는 admin 클라이언트.
 *
 * 절대 클라이언트 코드(use client / 브라우저로 가는 번들)에서 import 금지.
 * 차감 함수 호출, 웹훅 처리, 시드 등 서버 단독 작업에서만 사용.
 *
 * NEXT_PUBLIC_ 접두사가 붙은 환경변수는 클라이언트로 노출되므로 service_role은
 * 반드시 SUPABASE_SERVICE_ROLE_KEY 이름 그대로 유지할 것.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "createAdminClient()는 서버에서만 호출 가능합니다. service_role 키가 브라우저로 노출되면 안 됩니다.",
    );
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
