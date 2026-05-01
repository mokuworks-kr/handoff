"use client";

/**
 * 페이지네이션 결과 시각화 — /lab/paginate 의 결과 카드.
 *
 * 분류 lab 의 components/classify/ResultView 와 같은 역할:
 *   - 결과 *표시* 만 담당. 호출·라우팅·저장은 부모(PaginateLab) 책임.
 *   - 옵셔널 children 슬롯으로 추가 액션 제공 ("다시 만들기" 등).
 *
 * ─────────────────────────────────────────────────────────────
 * 입력 — /api/lab/paginate 응답 형태
 * ─────────────────────────────────────────────────────────────
 *
 * {
 *   pages: Page[],              // SVG 미리보기용 frames 포함
 *   llmRaw: LlmBookOutput,      // rationale, slotBlockRefs, splitReason, hiddenSlotIds
 *   validation: { hasError, validPageCount, issues: ValidationIssue[] },
 *   llm: { model, inputTokens, outputTokens, cacheReadTokens?, rawCostUsd, stopReason },
 *   stylesPatch: Document["styles"],
 *   projectId: string,
 *   saved: false,
 * }
 *
 * ─────────────────────────────────────────────────────────────
 * 표시 영역
 * ─────────────────────────────────────────────────────────────
 *
 * 1. 메타 카드 — 페이지 수 / 검증 카운트 / LLM 호출 비용·토큰
 * 2. 검증 이슈 — error/warn/info 별 묶음, 메시지 + 페이지·슬롯·블록 ID
 * 3. 의도된 누락 (intentionalOmissions) — §1 약속 추적
 * 4. 페이지 카드 그리드 — SVG 미리보기 + LlmPageOutput 메타 (pattern, role, side, splitReason, variants, rationale, slotBlockRefs)
 * 5. children 슬롯 — 부모가 추가 액션 박을 수 있게
 */

import { useState } from "react";
import { PageSvgPreview } from "./PageSvgPreview";
import type { Page, Format } from "@/lib/types/document";
import type { Color } from "@/lib/types/styles";
import type {
  LlmBookOutput,
  LlmPageOutput,
  ValidationIssue,
  ValidationCode,
} from "@/lib/paginate/types";

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────

export type PaginateResultViewProps = {
  /** lab API 가 돌려준 응답 본체. 부모가 그대로 패스. */
  result: PaginateResultPayload;
  /** SVG 미리보기에 들어갈 format. 보통 project.document.format. */
  format: Format;
  /** 색상 카탈로그. 보통 project.document.styles.colors + result.stylesPatch.colors 머지. */
  colors?: readonly Color[];
  /** 결과 아래 추가 액션 슬롯 ("다시 만들기", "이대로 적용" 등) */
  children?: React.ReactNode;
};

/**
 * lab API 응답 형태. 라우트와 모양 정확히 맞춤.
 * route.ts 응답 변경 시 같이 업데이트.
 */
export type PaginateResultPayload = {
  projectId: string;
  pages: Page[];
  llmRaw?: LlmBookOutput;
  validation: {
    hasError: boolean;
    validPageCount: number;
    issues: ValidationIssue[];
  };
  llm: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    rawCostUsd: number;
    stopReason: string;
  };
  stylesPatch?: unknown;
  saved?: boolean;
};

// ─────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────

export function PaginateResultView({
  result,
  format,
  colors = [],
  children,
}: PaginateResultViewProps) {
  // 페이지 + LLM 메타 매칭 — pageNumber 키로 안전하게
  const llmByPageNumber = new Map<number, LlmPageOutput>();
  if (result.llmRaw) {
    for (const llmPage of result.llmRaw.pages) {
      llmByPageNumber.set(llmPage.pageNumber, llmPage);
    }
  }

  // severity 별 카운트
  const severityCounts = countBySeverity(result.validation.issues);

  return (
    <div className="space-y-6">
      {/* 1) 메타 카드 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="페이지" value={String(result.pages.length)} />
        <Stat
          label="검증 error"
          value={String(severityCounts.error)}
          accent={severityCounts.error > 0 ? "red" : undefined}
        />
        <Stat
          label="검증 warn"
          value={String(severityCounts.warn)}
          accent={severityCounts.warn > 0 ? "amber" : undefined}
        />
        <Stat
          label="검증 info"
          value={String(severityCounts.info)}
        />
      </div>

      {/* LLM 호출 메타 */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          LLM 호출
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <KeyVal k="모델" v={result.llm.model} />
          <KeyVal k="비용 (USD)" v={`$${result.llm.rawCostUsd.toFixed(4)}`} />
          <KeyVal k="입력 토큰" v={result.llm.inputTokens.toLocaleString()} />
          <KeyVal k="출력 토큰" v={result.llm.outputTokens.toLocaleString()} />
          {result.llm.cacheReadTokens !== undefined &&
            result.llm.cacheReadTokens > 0 && (
              <KeyVal
                k="캐시 읽기"
                v={result.llm.cacheReadTokens.toLocaleString()}
              />
            )}
          <KeyVal k="stop reason" v={result.llm.stopReason} mono />
        </div>
      </div>

      {/* 2) 검증 이슈 */}
      {result.validation.issues.length > 0 && (
        <ValidationIssuesView issues={result.validation.issues} />
      )}

      {/* 3) 의도된 누락 (§1 약속 추적) */}
      {result.llmRaw?.intentionalOmissions &&
        result.llmRaw.intentionalOmissions.length > 0 && (
          <IntentionalOmissionsView
            omissions={result.llmRaw.intentionalOmissions}
          />
        )}

      {/* 4) 페이지 카드 그리드 */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            페이지 ({result.pages.length})
          </div>
          <div className="text-[11px] text-neutral-400">
            클릭하면 LLM 메타 펼쳐집니다
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {result.pages.map((page, idx) => {
            const llmPage = llmByPageNumber.get(idx + 1);
            return (
              <PageCard
                key={page.id}
                page={page}
                pageNumber={idx + 1}
                llmPage={llmPage}
                format={format}
                colors={colors}
              />
            );
          })}
        </div>
      </div>

      {/* 5) children 슬롯 */}
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 페이지 카드 1개 — SVG + 콤포지션 메타 + 펼침 LLM 메타
// ─────────────────────────────────────────────────────────────

function PageCard({
  page,
  pageNumber,
  llmPage,
  format,
  colors,
}: {
  page: Page;
  pageNumber: number;
  llmPage?: LlmPageOutput;
  format: Format;
  colors: readonly Color[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-md border border-neutral-200 bg-white">
      {/* SVG 미리보기 */}
      <div className="border-b border-neutral-100 bg-neutral-50 p-2">
        <PageSvgPreview
          page={page}
          format={format}
          colors={colors}
          width={220}
          showMargins
        />
      </div>

      {/* 메타 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full flex-col items-start gap-1 px-3 py-2 text-left hover:bg-neutral-50"
      >
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs font-medium text-neutral-900">
            p.{pageNumber}
          </span>
          <span className="font-mono text-[10px] uppercase text-neutral-400">
            {page.side}
          </span>
        </div>
        <div className="font-mono text-[11px] text-neutral-700">
          {page.composition}
        </div>
        {llmPage && (
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <Tag tone="neutral">{llmPage.role}</Tag>
            <Tag tone={splitReasonTone(llmPage.splitReason)}>
              {llmPage.splitReason}
            </Tag>
            {llmPage.variants &&
              Object.entries(llmPage.variants).map(([k, v]) => (
                <Tag key={k} tone="muted">
                  {k}={v}
                </Tag>
              ))}
          </div>
        )}
      </button>

      {/* 펼침 — 슬롯별 블록 ID + rationale + hidden slots */}
      {expanded && llmPage && (
        <div className="space-y-2 border-t border-neutral-100 bg-neutral-50/50 px-3 py-2 text-[11px]">
          {llmPage.rationale && (
            <div>
              <div className="font-mono uppercase text-neutral-400">
                rationale
              </div>
              <div className="mt-0.5 text-neutral-700">{llmPage.rationale}</div>
            </div>
          )}
          <div>
            <div className="font-mono uppercase text-neutral-400">
              slotBlockRefs
            </div>
            <div className="mt-0.5 space-y-0.5">
              {Object.entries(llmPage.slotBlockRefs).map(([slot, blockIds]) => (
                <div key={slot} className="flex gap-2">
                  <span className="font-mono text-neutral-600">{slot}:</span>
                  <span className="font-mono text-neutral-500">
                    {blockIds.length === 0
                      ? "(empty)"
                      : blockIds.join(", ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {llmPage.hiddenSlotIds && llmPage.hiddenSlotIds.length > 0 && (
            <div>
              <div className="font-mono uppercase text-neutral-400">
                hiddenSlotIds
              </div>
              <div className="mt-0.5 font-mono text-neutral-500">
                {llmPage.hiddenSlotIds.join(", ")}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 검증 이슈 묶음
// ─────────────────────────────────────────────────────────────

function ValidationIssuesView({ issues }: { issues: ValidationIssue[] }) {
  // severity 별 정렬: error → warn → info
  const sorted = [...issues].sort((a, b) => {
    const order: Record<ValidationIssue["severity"], number> = {
      error: 0,
      warn: 1,
      info: 2,
    };
    return order[a.severity] - order[b.severity];
  });

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        검증 이슈 ({issues.length})
      </div>
      <div className="mt-3 space-y-1.5">
        {sorted.map((issue, i) => (
          <IssueRow key={i} issue={issue} />
        ))}
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: ValidationIssue }) {
  const tone = severityTone(issue.severity);
  return (
    <div
      className="flex flex-wrap items-start gap-2 rounded px-2 py-1.5 text-xs"
      style={{ backgroundColor: tone.bg, color: tone.fg }}
    >
      <span
        className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase"
        style={{ backgroundColor: tone.badgeBg, color: tone.badgeFg }}
      >
        {issue.severity}
      </span>
      <span className="font-mono text-[10px] uppercase opacity-70">
        {issue.code}
      </span>
      <span className="flex-1 min-w-0">{issue.message}</span>
      <div className="flex gap-1.5 text-[10px] opacity-60">
        {issue.pageNumber !== undefined && (
          <span className="font-mono">p.{issue.pageNumber}</span>
        )}
        {issue.slotId && <span className="font-mono">slot={issue.slotId}</span>}
        {issue.blockId && (
          <span className="font-mono">block={issue.blockId}</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 의도된 누락
// ─────────────────────────────────────────────────────────────

function IntentionalOmissionsView({
  omissions,
}: {
  omissions: NonNullable<LlmBookOutput["intentionalOmissions"]>;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        의도된 누락 ({omissions.length})
      </div>
      <div className="mt-1 text-[11px] text-neutral-500">
        LLM 이 명시적으로 어느 블록을 제외했는지. 침묵 누락은 검증에서 error.
      </div>
      <div className="mt-3 space-y-2">
        {omissions.map((omission, i) => (
          <div
            key={i}
            className="rounded bg-neutral-50 px-3 py-2 text-xs"
          >
            <div className="font-mono text-[10px] text-neutral-500">
              {omission.blockIds.join(", ")}
            </div>
            <div className="mt-0.5 text-neutral-700">{omission.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 작은 헬퍼 컴포넌트들
// ─────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "red" | "amber";
}) {
  const colorClass =
    accent === "red"
      ? "text-red-700"
      : accent === "amber"
        ? "text-amber-700"
        : "text-neutral-900";
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${colorClass}`}
      >
        {value}
      </div>
    </div>
  );
}

function KeyVal({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <div className="text-[10px] uppercase tracking-wide text-neutral-400">
        {k}
      </div>
      <div
        className={`text-sm text-neutral-900 ${mono ? "font-mono text-xs" : "tabular-nums"}`}
      >
        {v}
      </div>
    </div>
  );
}

function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "neutral" | "muted" | "good" | "warn" | "info";
}) {
  const colors: Record<typeof tone, { bg: string; fg: string }> = {
    neutral: { bg: "#F5F5F5", fg: "#404040" },
    muted: { bg: "#FAFAFA", fg: "#737373" },
    good: { bg: "#ECFDF5", fg: "#065F46" },
    warn: { bg: "#FFFBEB", fg: "#92400E" },
    info: { bg: "#EFF6FF", fg: "#1E40AF" },
  };
  const c = colors[tone];
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono uppercase"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// 헬퍼 함수
// ─────────────────────────────────────────────────────────────

function countBySeverity(
  issues: readonly ValidationIssue[],
): { error: number; warn: number; info: number } {
  const c = { error: 0, warn: 0, info: 0 };
  for (const i of issues) c[i.severity]++;
  return c;
}

function severityTone(severity: ValidationIssue["severity"]): {
  bg: string;
  fg: string;
  badgeBg: string;
  badgeFg: string;
} {
  switch (severity) {
    case "error":
      return {
        bg: "#FEF2F2",
        fg: "#7F1D1D",
        badgeBg: "#FECACA",
        badgeFg: "#7F1D1D",
      };
    case "warn":
      return {
        bg: "#FFFBEB",
        fg: "#78350F",
        badgeBg: "#FDE68A",
        badgeFg: "#78350F",
      };
    case "info":
      return {
        bg: "#F8FAFC",
        fg: "#334155",
        badgeBg: "#E2E8F0",
        badgeFg: "#475569",
      };
  }
}

function splitReasonTone(
  reason: LlmPageOutput["splitReason"],
): "good" | "info" | "warn" | "muted" {
  switch (reason) {
    case "page-separator":
      return "good"; // 작성자 명시 신호 — 1순위
    case "section-boundary":
      return "info";
    case "content-fit":
      return "muted";
    case "merged":
      return "warn";
  }
}
