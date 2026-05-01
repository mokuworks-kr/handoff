/**
 * /lab/paginate — 페이지네이션 검증 페이지.
 *
 * 분류 lab(/lab/classify) 패턴 따름:
 *   1) 비로그인 → /login
 *   2) 로그인했지만 화이트리스트 외 → /dashboard
 *   3) 통과하면 PaginateLab(클라이언트) 에 위임
 *
 * 차이점:
 *   - 서버에서 분류된 프로젝트 목록을 미리 가져와 props 로 넘김
 *     (lab 사용자가 어떤 프로젝트를 페이지네이션할지 선택할 수 있게)
 *   - 분류된 프로젝트 = document.manuscript 가 있는 것
 *
 * 환경변수: LAB_ALLOWED_EMAILS (whitelist.ts 참조)
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isLabAllowed } from "@/lib/auth/whitelist";
import { PaginateLab } from "./PaginateLab";
import type { Project } from "@/lib/types";

export const metadata = {
  title: "Paginate Lab",
  robots: { index: false, follow: false },
};

export default async function PaginateLabPage() {
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

  // 분류된 프로젝트 목록 — RLS 가 본인 행만 통과시킴.
  // 큰 document JSONB 까지 다 가져오지 않고 목록 표시에 필요한 만큼만 select.
  // 다만 manuscript 존재 여부를 보려면 document 가 필요 — 옵션 두 가지:
  //   (a) document 통째로 가져와서 JS 쪽에서 manuscript 존재 필터
  //   (b) PostgREST 의 select 로 document->'manuscript' is not null 인 것만
  // 1차는 (a) 로 단순하게. 프로젝트 50 개 한도이고 lab 은 검증용이라 충분.
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, document, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);

  const allProjects = (projects ?? []) as Pick<
    Project,
    "id" | "title" | "document" | "created_at" | "updated_at"
  >[];

  // 분류된 프로젝트만 — manuscript 존재가 페이지네이션 가능 조건
  const classifiedProjects = allProjects.filter(
    (p) => p.document.manuscript != null,
  );

  return (
    <div className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-neutral-900">
            Paginate Lab
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            분류된 프로젝트를 골라 페이지네이션 LLM 결과를 확인합니다. 비공개
            검증용. DB 저장·크레딧 차감 없음.
          </p>
        </div>
        <PaginateLab
          userEmail={user.email ?? "(no email)"}
          classifiedProjects={classifiedProjects}
        />
      </div>
    </div>
  );
}
