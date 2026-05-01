"use client";

/**
 * ProjectPaginatePanel — 본 흐름 페이지네이션 패널 (M3b-4).
 *
 * /projects/[id] 본 사용자 화면에서:
 *   - "페이지 만들기" 버튼 (또는 결과 있으면 "다시 만들기")
 *   - /api/paginate 호출 (DB 저장 + 크레딧 차감)
 *   - 응답의 pages + validation + llm 받아 PaginateResultView 즉시 렌더 (새 결과 모드)
 *   - 에러는 사용자 친화 메시지 + "자세히 보기" 펼침
 *
 * lab 라우트(PaginateLab)와의 차이:
 *   - lab 은 프로젝트 선택 UI 가짐. 여기는 부모(서버 컴포넌트)가 projectId 를 박아 넘김
 *   - lab 은 DB 저장 안 함. 여기는 본 라우트라 자동 저장
 *   - lab 은 검증 디버그용. 여기는 사용자 화면이라 톤 부드럽게
 *
 * 표시 모드 — B안 (M3b-4 박힘):
 *   - **재방문 모드**: DB 의 Document.pages 만 있고 메타 없음 → 슬림 페이지 그리드만
 *     (검증 카운트·LLM 비용 등 메타 카드 숨김). PageSvgPreview 직접 사용.
 *   - **새 결과 모드**: 방금 /api/paginate 호출 응답 받음 → PaginateResultView 풀 표시
 *     (메타 카드 + LLM 카드 + 검증 이슈 + 페이지 그리드).
 *
 * 초기 결과:
 *   - 부모 서버 컴포넌트가 DB의 Document.pages 를 읽어 initialPages 로 넘김
 *   - 처음 들어왔을 때 페이지네이션이 이미 돌아간 상태면 슬림 그리드 즉시 표시
 *   - 비어있으면 (initialPages.length === 0) 버튼만 표시
 *   - "다시 만들기" 누르면 새 결과 모드로 전환 (풀 ResultView)
 */

import { useState } from "react";
import {
  PaginateResultView,
  type PaginateResultPayload,
} from "@/components/paginate/ResultView";
import { PageSvgPreview } from "@/components/paginate/PageSvgPreview";
import type { Format, Page } from "@/lib/types/document";
import type { Color } from "@/lib/types/styles";
import type { ValidationIssue } from "@/lib/paginate/types";

// ─────────────────────────────────────────────────────────────
// API 응답 형태 — /api/paginate 라우트 응답과 정확히 맞춤
// ─────────────────────────────────────────────────────────────

/**
 * /api/paginate 200 응답.
 * lab 응답(PaginateResultPayload)의 슈퍼셋 — 그대로 ResultView 에 넘길 수 있음.
 */
type PaginateApiSuccess = PaginateResultPayload & {
  saved: true;
  validation: PaginateResultPayload["validation"] & {
    errorCount?: number;
    warnCount?: number;
    infoCount?: number;
  };
};

/**
 * /api/paginate 4xx/5xx 응답.
 * 본 라우트가 돌려주는 에러 모양을 그대로 받음.
 */
type PaginateApiError = {
  error: string;
  code?: string;
  message?: string;
  // 422 (VALIDATION_FAILED) 인 경우만 박힘
  validationIssues?: Array<
    Pick<ValidationIssue, "severity" | "code" | "message" | "pageNumber" | "slotId" | "blockId">
  >;
  // 402 (INSUFFICIENT_CREDITS) 인 경우만 박힘
  balance?: number;
  required?: number;
  // 502 (LLM 호출 실패) 인 경우만 박힘
  provider?: string;
};

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────

type Props = {
  projectId: string;
  format: Format;
  /** 색상 카탈로그 — SVG 미리보기에 쓰임. project.document.styles.colors */
  colors: readonly Color[];
  /**
   * DB 에 이미 저장돼있는 페이지네이션 결과 (있으면).
   * Document.pages 그대로. 메타정보(검증 카운트·LLM 비용)는 DB에 없어서 못 받음.
   * 처음 들어왔을 때 슬림 그리드로 즉시 표시. 빈 배열이면 "페이지 만들기" 버튼만.
   */
  initialPages: Page[];
};

// ─────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────

export function ProjectPaginatePanel({
  projectId,
  format,
  colors,
  initialPages,
}: Props) {
  // 새 결과 — 방금 페이지네이션 호출해서 받은 풀 페이로드 (메타 포함).
  // null 이면 재방문 모드 (initialPages 표시).
  const [freshResult, setFreshResult] = useState<PaginateResultPayload | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PaginateApiError | null>(null);

  const runPaginate = async () => {
    setLoading(true);
    setError(null);
    // 에러 나도 기존 결과 유지 (사용자가 보던 페이지가 갑자기 사라지면 혼란).
    // 성공 시에만 freshResult 갈아끼움.
    try {
      const res = await fetch("/api/paginate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data as PaginateApiError);
      } else {
        setFreshResult(data as PaginateApiSuccess);
      }
    } catch (e) {
      setError({
        error: "네트워크 오류",
        message: e instanceof Error ? e.message : "알 수 없는 오류",
      });
    } finally {
      setLoading(false);
    }
  };

  // 표시 모드 결정:
  //   - 새 결과가 있으면 → 풀 ResultView (메타 카드 + LLM 카드 + 검증 + 그리드)
  //   - 새 결과 없고 initialPages 있으면 → 슬림 그리드만 (재방문 모드)
  //   - 둘 다 없으면 → 버튼만
  const hasFresh = freshResult !== null && freshResult.pages.length > 0;
  const hasInitial = !hasFresh && initialPages.length > 0;
  const hasResult = hasFresh || hasInitial;

  return (
    <div className="space-y-6">
      {/* 액션 영역 — 결과 있으면 "다시 만들기", 없으면 "페이지 만들기" */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm font-medium text-ink-900">
              {hasResult ? "디자인 페이지" : "디자인 페이지 만들기"}
            </div>
            <div className="text-xs text-ink-600">
              {hasResult
                ? "마음에 안 들면 다시 만들 수 있어요. 결과는 매번 약간 달라집니다."
                : "원고를 페이지 디자인으로 변환합니다. 약 15~40초 걸려요."}
            </div>
          </div>
          <button
            type="button"
            onClick={runPaginate}
            disabled={loading}
            className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "만드는 중..."
              : hasResult
                ? "다시 만들기"
                : "페이지 만들기"}
          </button>
        </div>
      </div>

      {/* 로딩 카드 */}
      {loading && (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-ink-600">
          페이지를 만들고 있어요. 잠시만 기다려주세요...
          <div className="mt-1 text-xs text-ink-400">
            보통 15~40초 정도 걸립니다.
          </div>
        </div>
      )}

      {/* 에러 카드 — 사용자 친화 메시지 + 자세히 보기 펼침 (C안) */}
      {error && <ErrorCard error={error} onRetry={runPaginate} />}

      {/* 새 결과 모드 — PaginateResultView 풀 표시 (메타 + LLM + 검증 + 그리드) */}
      {hasFresh && freshResult && (
        <PaginateResultView
          result={freshResult}
          format={format}
          colors={colors}
        />
      )}

      {/* 재방문 모드 — 슬림 그리드만 (메타 카드 / LLM 카드 / 검증 카드 숨김) */}
      {hasInitial && (
        <SlimPagesGrid pages={initialPages} format={format} colors={colors} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 슬림 페이지 그리드 — 재방문 모드 (B안)
// ─────────────────────────────────────────────────────────────
//
// 메타정보(검증 카운트, LLM 비용) 가 DB 에 없어서 ResultView 풀버전을 못 씀.
// 페이지 카드 그리드만 박는다 — SVG + p.번호 + side.
// LLM 메타(rationale, slotBlockRefs) 도 없어서 펼침 미박. 단순 표시.

function SlimPagesGrid({
  pages,
  format,
  colors,
}: {
  pages: Page[];
  format: Format;
  colors: readonly Color[];
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-400">
          페이지 ({pages.length})
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {pages.map((page, idx) => (
          <div
            key={page.id}
            className="overflow-hidden rounded-md border border-border bg-white"
          >
            <div className="border-b border-neutral-100 bg-neutral-50 p-2">
              <PageSvgPreview
                page={page}
                format={format}
                colors={colors}
                width={220}
                showMargins
              />
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-xs font-medium text-ink-900">
                p.{idx + 1}
              </span>
              <span className="font-mono text-[10px] uppercase text-ink-400">
                {page.side}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 에러 카드 — 친절한 메시지 + "자세히 보기" 펼침
// ─────────────────────────────────────────────────────────────

function ErrorCard({
  error,
  onRetry,
}: {
  error: PaginateApiError;
  onRetry: () => void;
}) {
  const friendly = friendlyErrorMessage(error);

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm font-medium text-red-900">
            {friendly.title}
          </div>
          <div className="text-xs text-red-800">{friendly.body}</div>
        </div>
        {friendly.canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-red-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
          >
            다시 시도
          </button>
        )}
      </div>

      {/* 자세히 보기 펼침 — 검증 단계 디버깅 + 미래 사용자 문의 시 자료 */}
      <details className="mt-4 border-t border-red-200 pt-3">
        <summary className="cursor-pointer text-xs font-medium text-red-800 hover:text-red-900">
          자세히 보기 (개발자용)
        </summary>
        <div className="mt-3 space-y-2 text-[11px] text-red-900/90">
          <div>
            <span className="font-mono uppercase opacity-70">
              {error.code ?? error.error}
            </span>
            {error.message && (
              <span className="ml-2 whitespace-pre-wrap">{error.message}</span>
            )}
          </div>
          {error.validationIssues && error.validationIssues.length > 0 && (
            <div className="space-y-1 rounded bg-white/60 p-3">
              <div className="font-medium uppercase tracking-wide">
                검증 이슈 ({error.validationIssues.length})
              </div>
              {error.validationIssues.map((i, idx) => (
                <div key={idx}>
                  <span className="font-mono uppercase opacity-70">
                    {i.code}
                  </span>
                  {" — "}
                  <span>{i.message}</span>
                  {i.pageNumber !== undefined && (
                    <span className="font-mono opacity-60">
                      {" "}
                      (p.{i.pageNumber})
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

/**
 * 에러 코드 → 사용자 친화 메시지 매핑.
 * code 가 없으면 fallback.
 */
function friendlyErrorMessage(error: PaginateApiError): {
  title: string;
  body: string;
  canRetry: boolean;
} {
  const code = error.code ?? "";
  switch (code) {
    case "INSUFFICIENT_CREDITS":
      return {
        title: "크레딧이 부족해요",
        body: `페이지 만들기에는 ${error.required ?? 30} 크레딧이 필요해요. 현재 잔액: ${error.balance ?? 0}.`,
        canRetry: false,
      };
    case "MANUSCRIPT_MISSING":
      return {
        title: "원고가 아직 없어요",
        body: "원고 분류 단계가 먼저 끝나야 페이지를 만들 수 있어요.",
        canRetry: false,
      };
    case "VALIDATION_FAILED":
      return {
        title: "페이지를 만들지 못했어요",
        body: "AI가 만든 결과가 검증을 통과하지 못했어요. 다시 시도하면 보통 해결됩니다.",
        canRetry: true,
      };
    case "INPUT_INVALID":
    case "VOCABULARY_EMPTY":
    case "PATTERN_LIST_EMPTY":
      return {
        title: "프로젝트 설정이 어긋나있어요",
        body: "디자인 토큰이 비어있거나 잘못됐어요. 새 프로젝트로 다시 시도해주세요.",
        canRetry: false,
      };
    case "LLM_OVERLOADED":
    case "LLM_TIMEOUT":
    case "LLM_RATE_LIMITED":
      return {
        title: "AI가 잠시 바쁘네요",
        body: "잠시 후 다시 시도해주세요.",
        canRetry: true,
      };
    case "PROFILE_NOT_FOUND":
    case "PROJECT_NOT_FOUND":
    case "FORBIDDEN":
      return {
        title: "접근할 수 없어요",
        body: "다시 로그인하거나 대시보드로 돌아가주세요.",
        canRetry: false,
      };
    case "DB_UPDATE_FAILED":
      return {
        title: "결과를 저장하지 못했어요",
        body: "다시 시도해주세요. 계속되면 잠시 후 시도하세요.",
        canRetry: true,
      };
    default:
      return {
        title: "페이지를 만들지 못했어요",
        body: "다시 시도해주세요. 계속되면 자세히 보기를 펼쳐 메시지를 확인하세요.",
        canRetry: true,
      };
  }
}
