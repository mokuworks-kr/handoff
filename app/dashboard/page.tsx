/**
 * /dashboard — 메인 대시보드.
 *
 * 표시:
 *   - 상단바 (이메일, 크레딧, 로그아웃)
 *   - "새 프로젝트 만들기" 버튼 (활성화) → /projects/new
 *   - 프로젝트 목록 카드 (있으면) 또는 빈 상태 메시지
 *
 * 프로젝트 카드 클릭 → /projects/[id] 로 이동.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Topbar } from "@/components/shared/topbar";
import { Button } from "@/components/ui/button";
import type { Profile, Project } from "@/lib/types";

export const metadata = {
  title: "대시보드 | Handoff",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 미들웨어가 이미 막아주지만 방어적으로
  if (!user) redirect("/login");

  // 프로필 조회
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  // 프로젝트 목록 — 최근 수정 순. RLS가 본인 행만 통과.
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, thumbnail_url, document, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);

  const credits = profile?.credit_balance ?? 0;
  const email = profile?.email ?? user.email ?? "";
  const projectList = (projects ?? []) as Pick<
    Project,
    "id" | "title" | "thumbnail_url" | "document" | "created_at" | "updated_at"
  >[];

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar email={email} credits={credits} />

      <main className="flex-1 px-6 py-10 max-w-6xl w-full mx-auto">
        {/* 헤더 */}
        <div className="flex items-end justify-between gap-4 mb-10">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">내 프로젝트</h1>
            <p className="text-sm text-ink-600">
              {projectList.length === 0
                ? "처음 시작하시나요? 5분 안에 회사소개서를 만들어볼 수 있어요."
                : `${projectList.length}개의 프로젝트`}
            </p>
          </div>
          <Button asChild size="lg">
            <Link href="/projects/new">새 프로젝트 만들기</Link>
          </Button>
        </div>

        {/* 빈 상태 또는 카드 그리드 */}
        {projectList.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-12 text-center bg-surface">
            <div className="max-w-sm mx-auto space-y-4">
              <h2 className="text-lg font-medium">아직 프로젝트가 없어요</h2>
              <p className="text-sm text-ink-600">
                원고만 있으면 됩니다. 자동으로 분석해드려요.
              </p>
              <div className="pt-2">
                <Button asChild size="lg">
                  <Link href="/projects/new">첫 프로젝트 만들기</Link>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projectList.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

type ProjectCardData = Pick<
  Project,
  "id" | "title" | "thumbnail_url" | "document" | "created_at" | "updated_at"
>;

function ProjectCard({ project }: { project: ProjectCardData }) {
  const sectionCount = project.document.manuscript?.sections.length ?? 0;
  const sourceFormat = project.document.manuscript?.source.format ?? "?";
  const updatedDate = new Date(project.updated_at).toLocaleDateString("ko-KR");

  return (
    <Link
      href={`/projects/${project.id}`}
      className="block rounded-xl border border-border bg-surface hover:border-ink-400 transition-colors p-5 space-y-3"
    >
      <div className="space-y-1">
        <h3 className="font-medium text-ink-900 truncate" title={project.title}>
          {project.title}
        </h3>
        <p className="text-xs text-ink-400">{updatedDate}</p>
      </div>
      <div className="flex items-center gap-3 text-xs text-ink-600">
        <span className="font-mono uppercase">{sourceFormat}</span>
        <span className="text-ink-400">·</span>
        <span>섹션 {sectionCount}개</span>
      </div>
    </Link>
  );
}
