/**
 * 브라우저(Client Component)에서 쓰는 Supabase 클라이언트.
 * 쿠키는 브라우저가 알아서 처리하므로 별도 콜백 불필요.
 */

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
