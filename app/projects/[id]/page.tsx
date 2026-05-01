/**
 * /projects/[id] — 프로젝트 상세 페이지.
 *
 * **임시 상태 (M3a-3 시점)**:
 *   M3b (페이지네이션 LLM)가 박힐 때까지 디자인 결과가 없음. 그래서:
 *   - 사용자에게 "원고가 잘 들어왔어요" 메시지
 *   - 작은 요약 (섹션 N개 인식, 형식 등) — 사용자에게 의미 있는 신호만
 *   - 분류 결과 디버그(ResultView)는 펼침으로 숨김 (선택적 표시)
 *   - "다음 단계 (디자인 생성)는 곧 추가됩니다" 안내
 *
 * M3b 박힐 때 이 페이지가:
 *   - 임시 메시지 → 실제 디자인 페이지 미리보기로 교체
 *   - ResultView 펼침 유지 (디자인 결과와 분류 결과를 같이 볼 수 있게)
 *
 * 미래 (M3c): 3-Pane 캔버스 + 자연어 편집이 박힘.
 */

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Topbar } from "@/components/shared/topbar";
import { Button } from "@/components/ui/button";
import type { Profile, Project } from "@/lib/types";
import { ResultView } from "@/components/classify/ResultView";

export const metadata = {
  title: "프로젝트 | Handoff",
};

type Params = Promise<{ id: string }>;

export default async function ProjectDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 프로젝트 조회 — RLS가 본인 행만 통과시킴
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single<Project>();

  if (!project) notFound();

  // 프로필 조회 — 상단바용
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  const credits = profile?.credit_balance ?? 0;
  const email = profile?.email ?? user.email ?? "";

  const manuscript = project.document.manuscript;
  const sectionCount = manuscript?.sections.length ?? 0;
  const blockCount = manuscript?.blocks.length ?? 0;
  const sourceFormat = manuscript?.source.format ?? "?";

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar email={email} credits={credits} />

      <main className="flex-1 px-6 py-10 max-w-4xl w-full mx-auto">
        {/* 헤더 */}
        <div className="space-y-2 mb-8">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight truncate">
              {project.title}
            </h1>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">대시보드로</Link>
            </Button>
          </div>
          <p className="text-xs text-ink-400 font-mono">{project.id}</p>
        </div>

        {/* 작은 요약 — 사용자에게 의미 있는 신호만 */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <SummaryCard label="형식" value={sourceFormat.toUpperCase()} />
          <SummaryCard label="블록" value={String(blockCount)} />
          <SummaryCard label="섹션" value={String(sectionCount)} />
        </div>

        {/* 임시 안내 — 다음 마일스톤 */}
        <div className="border border-border rounded-xl bg-surface p-8 text-center space-y-3 mb-8">
          <h2 className="text-lg font-medium">원고를 잘 받았어요</h2>
          <p className="text-sm text-ink-600">
            다음 단계(디자인 생성)는 곧 추가됩니다.
            <br />
            지금은 원고가 정확히 분석됐는지만 확인할 수 있어요.
          </p>
          <p className="text-xs text-ink-400">
            마일스톤 M3b — 페이지네이션 LLM 작업 중
          </p>
        </div>

        {/* 분류 결과 — 펼침으로 숨김 (디버그/검증용) */}
        {manuscript && (
          <details className="rounded-lg border border-border bg-surface mb-6">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-600 hover:bg-canvas">
              상세 분석 결과 보기 (디버그용)
            </summary>
            <div className="border-t border-border p-6">
              <ResultView result={manuscript} />
            </div>
          </details>
        )}

        {/* 푸터 액션 */}
        <div className="flex items-center justify-between text-xs text-ink-400 pt-4">
          <span>
            만든 날짜: {new Date(project.created_at).toLocaleString("ko-KR")}
          </span>
          <span>스키마 v{project.document.schemaVersion}</span>
        </div>
      </main>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-400">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-ink-900">{value}</div>
    </div>
  );
}
