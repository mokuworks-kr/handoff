import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Topbar } from "@/components/shared/topbar";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 미들웨어가 이미 막아주지만 방어적으로
  if (!user) redirect("/login");

  // 프로필 조회 (신규 가입자라면 트리거가 이미 행을 만들어 둠)
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  // 프로필이 아직 없을 가능성 (트리거 실패 등) — 최소값으로 폴백
  const credits = profile?.credit_balance ?? 0;
  const email = profile?.email ?? user.email ?? "";

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar email={email} credits={credits} />

      <main className="flex-1 px-6 py-10 max-w-6xl w-full mx-auto">
        <div className="space-y-2 mb-10">
          <h1 className="text-2xl font-semibold tracking-tight">내 프로젝트</h1>
          <p className="text-sm text-ink-600">
            처음 시작하시나요? 5분 안에 회사소개서를 만들어볼 수 있어요.
          </p>
        </div>

        {/* 빈 상태 */}
        <div className="border border-dashed border-border rounded-xl p-12 text-center bg-surface">
          <div className="max-w-sm mx-auto space-y-4">
            <h2 className="text-lg font-medium">아직 프로젝트가 없어요</h2>
            <p className="text-sm text-ink-600">
              원고만 있으면 됩니다. 자동으로 페이지를 짜드릴게요.
            </p>
            <div className="pt-2">
              <Button disabled size="lg">
                새 프로젝트 만들기 (M3에서 활성화)
              </Button>
            </div>
            <p className="text-xs text-ink-400 pt-2">
              지금은 마일스톤 1 — 인증과 인프라까지 동작합니다.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
