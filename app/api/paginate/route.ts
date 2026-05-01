/**
 * 페이지네이션 라우트 (M3b-2-e).
 *
 * POST /api/paginate
 * Body: { projectId: string }
 *
 * ─────────────────────────────────────────────────────────────
 * 호출 시나리오
 * ─────────────────────────────────────────────────────────────
 *
 * 1. 사용자가 분류·프로젝트 생성 후 "이 디자인으로 페이지 만들기" 버튼
 *    → /api/paginate POST { projectId }
 *    → 새 Document.pages 박힘
 *
 * 2. 사용자가 디자인 갈아끼우고 "다시 만들기" 버튼 (M3c)
 *    → 같은 라우트 호출. Document.pages 덮어쓰기.
 *    → 정책 §7-8: manuscript 는 그대로, pages 는 매번 새로.
 *
 * ─────────────────────────────────────────────────────────────
 * 분류 라우트 패턴 따름 (§15.3)
 * ─────────────────────────────────────────────────────────────
 *
 * 1. 인증 — Supabase getUser()
 * 2. 입력 파싱 — projectId (UUID)
 * 3. 잔액 사전 체크 — MIN_CREDIT_BALANCE_FOR_PAGINATE
 * 4. projects 테이블에서 Document 가져오기 + ownership 검증
 * 5. paginateBook() 호출
 * 6. Document.pages = pages, Document.styles = stylesPatch 덮어쓰기
 * 7. projects 테이블 update
 * 8. 크레딧 차감 (deduct_credits RPC, 멱등키)
 * 9. 응답: pages 갯수 + validation 요약 + llm 메타
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정
 * ─────────────────────────────────────────────────────────────
 *
 * - **책임 분리**: paginateBook() 은 DB 안 건드림 — 이 라우트가 DB 책임.
 * - **멱등키**: paginate:${projectId}:${timestamp} — 매 호출 새 (사용자가 "다시 만들기"
 *   누를 때마다 새 페이지네이션이 의도). 같은 키 캐싱은 callTool 레벨 (미래 M3b-3+).
 * - **차감 실패해도 결과 반환**: 페이지네이션 성공 + 차감 RPC 실패 케이스에서 사용자 경험 우선.
 *   별도 로그 남김. M4 정식 가격 정책 결정 시 정밀화.
 * - **patterns 좁히기**: getPatternsForVocabulary() 결과를 paginateBook() 에 넘김.
 *   §16.6 후보 좁히기 (어휘로 1차).
 * - **artifactType / format**: Document 에서 그대로 추출 (프로젝트 생성 시 박힘).
 */

import { NextResponse, type NextRequest } from "next/server";

import { paginateBook } from "@/lib/paginate";
import {
  MIN_CREDIT_BALANCE_FOR_PAGINATE,
  PaginateError,
} from "@/lib/paginate/types";
import { getPatternsForVocabulary } from "@/lib/layout/patterns";
import { createClient } from "@/lib/supabase/server";
import type { Document } from "@/lib/types/document";

// ─────────────────────────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────────────────────────

type PaginateResponseSuccess = {
  ok: true;
  projectId: string;
  pageCount: number;
  validation: {
    issueCount: number;
    warnCount: number;
    infoCount: number;
  };
  llm: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    rawCostUsd: number;
  };
};

type PaginateResponseError = {
  ok: false;
  error: {
    code: string;
    message: string;
    /** 검증 실패 시 issues — UI 가 표시 */
    validationIssues?: Array<{
      severity: "error" | "warn" | "info";
      code: string;
      message: string;
      pageNumber?: number;
      slotId?: string;
      blockId?: string;
    }>;
  };
};

// ─────────────────────────────────────────────────────────────
// POST 핸들러
// ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. 인증
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json<PaginateResponseError>(
      { ok: false, error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다" } },
      { status: 401 },
    );
  }

  // 2. 입력 파싱
  let body: { projectId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<PaginateResponseError>(
      {
        ok: false,
        error: { code: "BAD_REQUEST", message: "요청 본문 JSON 파싱 실패" },
      },
      { status: 400 },
    );
  }

  if (typeof body.projectId !== "string" || body.projectId.length === 0) {
    return NextResponse.json<PaginateResponseError>(
      {
        ok: false,
        error: { code: "BAD_REQUEST", message: "projectId 가 필요합니다" },
      },
      { status: 400 },
    );
  }
  const projectId = body.projectId;

  // 3. 잔액 사전 체크
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("credit_balance")
    .eq("user_id", user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json<PaginateResponseError>(
      {
        ok: false,
        error: {
          code: "PROFILE_NOT_FOUND",
          message: "사용자 프로필을 찾을 수 없습니다",
        },
      },
      { status: 500 },
    );
  }

  if (profile.credit_balance < MIN_CREDIT_BALANCE_FOR_PAGINATE) {
    return NextResponse.json<PaginateResponseError>(
      {
        ok: false,
        error: {
          code: "INSUFFICIENT_CREDIT",
          message: `크레딧 잔액이 부족합니다 (필요: ${MIN_CREDIT_BALANCE_FOR_PAGINATE}, 현재: ${profile.credit_balance})`,
        },
      },
      { status: 402 },
    );
  }

  // 4. projects 테이블에서 Document 가져오기 + ownership 검증
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, owner_id, document")
    .eq("id", projectId)
    .single();

  if (projectError || !project) {
    return NextResponse.json<PaginateResponseError>(
      {
        ok: false,
        error: { code: "PROJECT_NOT_FOUND", message: "프로젝트를 찾을 수 없습니다" },
      },
      { status: 404 },
    );
  }

  if (project.owner_id !== user.id) {
    return NextResponse.json<PaginateResponseError>(
      {
        ok: false,
        error: { code: "FORBIDDEN", message: "이 프로젝트에 접근 권한이 없습니다" },
      },
      { status: 403 },
    );
  }

  const document: Document = project.document;
  if (!document.manuscript) {
    return NextResponse.json<PaginateResponseError>(
      {
        ok: false,
        error: {
          code: "MANUSCRIPT_MISSING",
          message:
            "프로젝트에 분류된 원고가 없습니다. 분류 단계를 먼저 완료해야 합니다",
        },
      },
      { status: 400 },
    );
  }

  // 5. paginateBook() 호출
  const vocabulary = document.designTokens.gridVocabulary ?? [];
  const patterns = getPatternsForVocabulary(vocabulary);

  const idempotencyKey = `paginate:${projectId}:${Date.now()}`;

  let output;
  try {
    output = await paginateBook({
      manuscript: document.manuscript,
      designTokens: document.designTokens,
      patterns,
      format: document.format,
      artifactType: document.artifactType,
      callerLabel: `paginate:${projectId}`,
      idempotencyKey,
    });
  } catch (e) {
    if (e instanceof PaginateError) {
      const status =
        e.code === "INPUT_INVALID" || e.code === "VOCABULARY_EMPTY" || e.code === "PATTERN_LIST_EMPTY"
          ? 400
          : e.code === "VALIDATION_FAILED"
            ? 422
            : 500;

      return NextResponse.json<PaginateResponseError>(
        {
          ok: false,
          error: {
            code: e.code,
            message: e.message,
            validationIssues: e.validation?.issues.map((i) => ({
              severity: i.severity,
              code: i.code,
              message: i.message,
              pageNumber: i.pageNumber,
              slotId: i.slotId,
              blockId: i.blockId,
            })),
          },
        },
        { status },
      );
    }

    console.error("[/api/paginate] 알 수 없는 에러:", e);
    return NextResponse.json<PaginateResponseError>(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "페이지네이션 중 알 수 없는 오류" },
      },
      { status: 500 },
    );
  }

  // 6. Document.pages + Document.styles 덮어쓰기
  const updatedDocument: Document = {
    ...document,
    pages: output.pages,
    styles: {
      paragraphStyles: [
        ...(output.stylesPatch.paragraphStyles ?? []),
      ],
      characterStyles: [
        ...(output.stylesPatch.characterStyles ?? []),
      ],
      colors: [...(output.stylesPatch.colors ?? [])],
      fonts: [...(output.stylesPatch.fonts ?? [])],
    },
  };

  // 7. projects 테이블 update
  const { error: updateError } = await supabase
    .from("projects")
    .update({
      document: updatedDocument,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);

  if (updateError) {
    console.error("[/api/paginate] projects update 실패:", updateError);
    return NextResponse.json<PaginateResponseError>(
      {
        ok: false,
        error: {
          code: "DB_UPDATE_FAILED",
          message: "페이지네이션은 성공했으나 DB 저장 실패",
        },
      },
      { status: 500 },
    );
  }

  // 8. 크레딧 차감 — 차감 실패해도 페이지네이션 성공 응답 (UX 우선)
  //
  // 정책: deduct_credits RPC (FOR UPDATE 행 잠금 + 트랜잭션 보장).
  //   비용 = output.llm.rawCostUsd / USD_PER_CREDIT, 올림.
  //   M4 정식 가격 정책 결정 시 markup 적용.
  const creditsToDeduct = computeCreditsToDeduct(output.llm.rawCostUsd);

  const { error: deductError } = await supabase.rpc("deduct_credits", {
    p_user_id: user.id,
    p_amount: creditsToDeduct,
    p_idempotency_key: idempotencyKey,
    p_metadata: {
      kind: "paginate",
      projectId,
      model: output.llm.model,
      inputTokens: output.llm.inputTokens,
      outputTokens: output.llm.outputTokens,
      rawCostUsd: output.llm.rawCostUsd,
    },
  });

  if (deductError) {
    // 페이지네이션 성공했으나 차감 실패. 로그만 남기고 사용자에게는 성공 응답.
    // M4 가격 정책에서 차감 실패 케이스 정밀화 (재시도, 보정 등).
    console.error(
      "[/api/paginate] 차감 실패 (페이지네이션은 성공):",
      deductError,
      { projectId, idempotencyKey, creditsToDeduct },
    );
  }

  // 9. 응답
  const issuesByseverity = countIssuesBySeverity(output.validation.issues);

  return NextResponse.json<PaginateResponseSuccess>({
    ok: true,
    projectId,
    pageCount: output.pages.length,
    validation: {
      issueCount: issuesByseverity.error,
      warnCount: issuesByseverity.warn,
      infoCount: issuesByseverity.info,
    },
    llm: {
      model: output.llm.model,
      inputTokens: output.llm.inputTokens,
      outputTokens: output.llm.outputTokens,
      rawCostUsd: output.llm.rawCostUsd,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────

/**
 * 크레딧 차감량 계산.
 *
 * 임시 정책: 1 USD = 100 크레딧 (USD_PER_CREDIT = 0.01).
 * 페이지네이션 1회 ~$0.20 → ~20 크레딧.
 *
 * M4 정식 가격 정책 결정 시 markup 2~3배 적용 + 패키지별 환산 결정.
 * 현재는 분류기와 동일 정책 (실비 1배).
 *
 * 최소 1 크레딧 차감 (rawCostUsd 가 매우 작아도 0 이 되지 않게).
 */
function computeCreditsToDeduct(rawCostUsd: number): number {
  const USD_PER_CREDIT = 0.01;
  const credits = Math.ceil(rawCostUsd / USD_PER_CREDIT);
  return Math.max(1, credits);
}

function countIssuesBySeverity(
  issues: Array<{ severity: "error" | "warn" | "info" }>,
): { error: number; warn: number; info: number } {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return counts;
}
