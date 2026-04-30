/**
 * /lab/classify — 분류기 검증 페이지.
 *
 * 보호 단계:
 *   1) 비로그인 → /login 리디렉트
 *   2) 로그인했지만 이메일 화이트리스트 외 → /dashboard 리디렉트 (404처럼 보이지 않게)
 *
 * 통과하면 클라이언트 컴포넌트(ClassifyLab)에 위임.
 *
 * 환경변수:
 *   LAB_ALLOWED_EMAILS="alice@example.com,bob@example.com"
 *
 * 비어있으면 아무도 접근 불가 (안전한 기본값 — whitelist.ts 참조).
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isLabAllowed } from "@/lib/auth/whitelist";
import { ClassifyLab } from "./ClassifyLab";

export const metadata = {
  title: "Classify Lab",
  robots: { index: false, follow: false }, // 검색 엔진에 안 잡히게
};

export default async function ClassifyLabPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (!isLabAllowed(user.email)) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-neutral-900">Classify Lab</h1>
          <p className="mt-1 text-sm text-neutral-600">
            원고 파일 또는 텍스트를 입력해 분류기 결과를 확인합니다. 비공개 검증용.
          </p>
        </div>
        <ClassifyLab userEmail={user.email ?? "(no email)"} />
      </div>
    </div>
  );
}
