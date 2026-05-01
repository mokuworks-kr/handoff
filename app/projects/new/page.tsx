/**
 * /projects/new — 새 프로젝트 입력 페이지.
 *
 * 흐름:
 *   1) 인증 체크 (모든 로그인 사용자, 화이트리스트 X)
 *   2) 잔액 체크 — MIN_CREDIT_BALANCE_FOR_CLASSIFY 미만이면 안내 표시
 *   3) NewProjectFlow 클라이언트 컴포넌트에 위임
 *
 * 사용자 흐름은 의도적으로 단순:
 *   원고 업로드 → 분석 중 → 결과 페이지 (/projects/[id])
 *
 * 분류 결과는 사용자에게 노출 X (디버그 정보라 의미 없음).
 * 사용자에게 의미 있는 건 "디자인 결과" — 그건 다음 마일스톤(M3b)에서 추가.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Topbar } from "@/components/shared/topbar";
import { Button } from "@/components/ui/button";
import { getCreditBalance } from "@/lib/credits/deduct";
import { MIN_CREDIT_BALANCE_FOR_CLASSIFY } from "@/lib/credits/convert";
import { NewProjectFlow } from "./NewProjectFlow";
import type { Profile } from "@/lib/types";

export const metadata = {
  title: "새 프로젝트 | Handoff",
};

export default async function NewProjectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 프로필 조회 — 상단바용
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  const credits = profile?.credit_balance ?? 0;
  const email = profile?.email ?? user.email ?? "";

  // 잔액 사전 체크 — UI 단계에서 미리 안내 (서버에서도 다시 체크함)
  const hasEnoughCredits = credits >= MIN_CREDIT_BALANCE_FOR_CLASSIFY;

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar email={email} credits={credits} />

      <main className="flex-1 px-6 py-10 max-w-3xl w-full mx-auto">
        <div className="space-y-2 mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">새 프로젝트</h1>
          <p className="text-sm text-ink-600">
            원고 파일을 올리면 자동으로 분석합니다.
          </p>
        </div>

        {!hasEnoughCredits ? (
          <div className="border border-amber-200 bg-amber-50 rounded-lg p-6 space-y-3">
            <h2 className="text-base font-medium text-amber-900">
              크레딧이 부족합니다
            </h2>
            <p className="text-sm text-amber-800">
              현재 잔액 {credits} 크레딧. 새 프로젝트를 만들려면 최소{" "}
              {MIN_CREDIT_BALANCE_FOR_CLASSIFY} 크레딧이 필요합니다.
            </p>
            <p className="text-xs text-amber-700">
              크레딧 충전은 다음 마일스톤(M4)에서 추가됩니다.
            </p>
            <div className="pt-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard">대시보드로 돌아가기</Link>
              </Button>
            </div>
          </div>
        ) : (
          <NewProjectFlow />
        )}
      </main>
    </div>
  );
}
