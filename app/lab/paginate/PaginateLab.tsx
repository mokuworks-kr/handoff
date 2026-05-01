"use client";

/**
 * Paginate Lab 클라이언트.
 *
 * 분류 lab(ClassifyLab) 패턴 따름:
 *   - 입력: 프로젝트 선택 (분류 lab 은 파일/텍스트 입력)
 *   - 호출: /api/lab/paginate POST { projectId }
 *   - 진행 표시 + 에러 표시
 *   - 결과는 PaginateResultView 에 위임
 *
 * 책임 안 가짐:
 *   - 결과 시각화 (ResultView 가 함)
 *   - SVG 그리기 (PageSvgPreview 가 함)
 *   - DB 저장 (lab 정책 — 안 함)
 *
 * "다시 만들기" 버튼은 ResultView 의 children 슬롯에 박힘 — 페이지 카드 그리드
 * 아래에 자연스럽게 위치.
 */

import { useState, useMemo } from "react";
import Link from "next/link";
import { PaginateResultView } from "@/components/paginate/ResultView";
import type {
  PaginateResultPayload,
} from "@/components/paginate/ResultView";
import type { Project } from "@/lib/types";

type ClassifiedProject = Pick<
  Project,
  "id" | "title" | "document" | "created_at" | "updated_at"
>;

type ApiError = {
  error: string;
  code?: string;
  message?: string;
  validation?: PaginateResultPayload["validation"];
};

export function PaginateLab({
  userEmail,
  classifiedProjects,
}: {
  userEmail: string;
  classifiedProjects: ClassifiedProject[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    classifiedProjects[0]?.id ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PaginateResultPayload | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const selected = useMemo(
    () => classifiedProjects.find((p) => p.id === selectedId) ?? null,
    [classifiedProjects, selectedId],
  );

  const runPaginate = async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/lab/paginate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data);
      } else {
        setResult(data as PaginateResultPayload);
      }
    } catch (e) {
      setError({
        error: "network",
        message: e instanceof Error ? e.message : "unknown",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 사용자 메모 */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-xs text-neutral-500">
        로그인: <span className="font-mono">{userEmail}</span>
      </div>

      {/* 프로젝트 선택 */}
      <div className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-6 py-3">
          <div className="text-sm font-medium text-neutral-900">
            분류된 프로젝트 선택
          </div>
          <div className="mt-0.5 text-xs text-neutral-500">
            {classifiedProjects.length === 0
              ? "분류된 프로젝트가 없습니다. /projects/new 에서 먼저 만드세요."
              : `${classifiedProjects.length}개 — 페이지네이션 가능 (manuscript 존재)`}
          </div>
        </div>

        {classifiedProjects.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <Link
              href="/projects/new"
              className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              새 프로젝트 만들기
            </Link>
          </div>
        ) : (
          <div className="max-h-72 divide-y divide-neutral-100 overflow-y-auto">
            {classifiedProjects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                selected={p.id === selectedId}
                onSelect={() => setSelectedId(p.id)}
              />
            ))}
          </div>
        )}

        {/* 실행 버튼 */}
        {classifiedProjects.length > 0 && (
          <div className="flex items-center justify-between border-t border-neutral-200 px-6 py-3">
            <div className="text-xs text-neutral-500">
              {selected ? (
                <>
                  선택:{" "}
                  <span className="text-neutral-900">{selected.title}</span>{" "}
                  <span className="font-mono text-neutral-400">
                    ({selected.id.slice(0, 8)})
                  </span>
                </>
              ) : (
                "프로젝트를 선택하세요"
              )}
            </div>
            <button
              type="button"
              onClick={runPaginate}
              disabled={!selectedId || loading}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "실행 중..." : "페이지네이션 실행"}
            </button>
          </div>
        )}
      </div>

      {/* 진행 */}
      {loading && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
          처리 중... (gemini-2.5-pro thinking 호출, 30~40페이지 기준 보통
          15~40초)
        </div>
      )}

      {/* 에러 */}
      {error && (
        <ErrorView error={error} />
      )}

      {/* 결과 — ResultView 에 위임 + 다시 만들기 버튼은 children 으로 */}
      {result && selected && (
        <PaginateResultView
          result={result}
          format={selected.document.format}
          colors={[
            ...selected.document.styles.colors,
            // stylesPatch 의 colors 도 참조용으로 머지 (lab 라우트 응답에 포함)
            // 다만 stylesPatch 는 카탈로그 동기화 결과라 보통 동일.
          ]}
        >
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={runPaginate}
                disabled={loading}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                다시 만들기
              </button>
              <span className="text-xs text-neutral-500">
                같은 프로젝트로 LLM 다시 호출. 결과는 매번 약간 다를 수
                있습니다.
              </span>
            </div>
            <div className="mt-3 text-[11px] text-neutral-400">
              ※ 이 결과는 저장되지 않았습니다. DB 적용은{" "}
              <Link
                href={`/projects/${selected.id}`}
                className="underline hover:text-neutral-600"
              >
                프로젝트 페이지
              </Link>{" "}
              에서.
            </div>
          </div>
        </PaginateResultView>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 프로젝트 행 1개
// ─────────────────────────────────────────────────────────────

function ProjectRow({
  project,
  selected,
  onSelect,
}: {
  project: ClassifiedProject;
  selected: boolean;
  onSelect: () => void;
}) {
  const m = project.document.manuscript;
  const sectionCount = m?.sections.length ?? 0;
  const blockCount = m?.blocks.length ?? 0;
  const sourceFormat = m?.source.format ?? "?";
  const updated = new Date(project.updated_at).toLocaleString("ko-KR");

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-4 px-6 py-3 text-left hover:bg-neutral-50 ${
        selected ? "bg-neutral-50" : ""
      }`}
    >
      <input
        type="radio"
        checked={selected}
        readOnly
        className="h-4 w-4 accent-neutral-900"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-neutral-900">
          {project.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
          <span className="font-mono uppercase">{sourceFormat}</span>
          <span className="text-neutral-300">·</span>
          <span>섹션 {sectionCount}</span>
          <span className="text-neutral-300">·</span>
          <span>블록 {blockCount}</span>
          <span className="text-neutral-300">·</span>
          <span>{updated}</span>
        </div>
      </div>
      <div className="font-mono text-[10px] text-neutral-400">
        {project.id.slice(0, 8)}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// 에러 표시
// ─────────────────────────────────────────────────────────────

function ErrorView({ error }: { error: ApiError }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <div className="font-medium">
        {error.error}
        {error.code ? ` (${error.code})` : ""}
      </div>
      {error.message && (
        <div className="mt-1 whitespace-pre-wrap text-xs">{error.message}</div>
      )}
      {/* 검증 실패 (422) 인 경우 issues 도 같이 표시 */}
      {error.validation && error.validation.issues.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-red-200 pt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-red-800">
            검증 이슈 ({error.validation.issues.length})
          </div>
          {error.validation.issues.map((i, idx) => (
            <div key={idx} className="text-xs">
              <span className="font-mono uppercase opacity-70">{i.code}</span>
              {" — "}
              <span>{i.message}</span>
              {i.pageNumber !== undefined && (
                <span className="font-mono opacity-60"> (p.{i.pageNumber})</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
