/**
 * /api/paginate — production 페이지네이션 라우트.
 *
 * ─────────────────────────────────────────────────────────────
 * 호출 시나리오
 * ─────────────────────────────────────────────────────────────
 *
 * 1. 분류·프로젝트 생성 후 "이 디자인으로 페이지 만들기" 버튼
 *    → /api/paginate POST { projectId }
 *    → 새 Document.pages 박힘
 *
 * 2. 디자인 갈아끼우고 "다시 만들기" 버튼 (M3c)
 *    → 같은 라우트 호출. Document.pages 덮어쓰기.
 *    → 정책 §7-8: manuscript 그대로, pages 매번 새로.
 *
 * ─────────────────────────────────────────────────────────────
 * 흐름 (분류 라우트 §15.3 패턴 동일)
 * ─────────────────────────────────────────────────────────────
 *
 * 1. 인증 — supabase.auth.getUser()
 * 2. 잔액 사전 체크 — getCreditBalance + MIN_CREDIT_BALANCE_FOR_PAGINATE
 * 3. 입력 파싱 — projectId
 * 4. 프로젝트 조회 + ownership + manuscript 존재 확인
 * 5. paginateBook() 호출
 * 6. Document.pages + Document.styles 덮어쓰기 → projects 업데이트
 * 7. 크레딧 차감 — deductCredits, idempotencyKey="paginate:${projectId}:${timestamp}"
 *    차감 실패해도 페이지네이션은 살아있음 (분류 라우트와 동일 정책)
 * 8. 응답
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { paginateBook } from "@/lib/paginate";
import { PaginateError } from "@/lib/paginate/types";
import { getPatternsForVocabulary } from "@/lib/layout/patterns";
import { LlmCallError } from "@/lib/llm";
import {
  usdToCredits,
  MIN_CREDIT_BALANCE_FOR_PAGINATE,
} from "@/lib/credits/convert";
import {
  deductCredits,
  getCreditBalance,
  DeductCreditsError,
} from "@/lib/credits/deduct";
import type { Document } from "@/lib/types/document";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // 1) 인증
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 2) 잔액 사전 체크
    const balance = await getCreditBalance(supabase, user.id);
    if (balance === null) {
      console.error("[paginate] profile not found", { userId: user.id });
      return NextResponse.json(
        { error: "profile not found", code: "PROFILE_NOT_FOUND" },
        { status: 500 },
      );
    }
    if (balance < MIN_CREDIT_BALANCE_FOR_PAGINATE) {
      return NextResponse.json(
        {
          error: "insufficient credits",
          code: "INSUFFICIENT_CREDITS",
          balance,
          required: MIN_CREDIT_BALANCE_FOR_PAGINATE,
        },
        { status: 402 },
      );
    }

    // 3) 입력 파싱
    let body: { projectId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "bad request", code: "BAD_REQUEST", message: "JSON 파싱 실패" },
        { status: 400 },
      );
    }
    if (typeof body.projectId !== "string" || body.projectId.length === 0) {
      return NextResponse.json(
        { error: "bad request", code: "BAD_REQUEST", message: "projectId 가 필요합니다" },
        { status: 400 },
      );
    }
    const projectId = body.projectId;

    // 4) 프로젝트 조회 + ownership + manuscript 존재
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, user_id, document")
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: "project not found", code: "PROJECT_NOT_FOUND" },
        { status: 404 },
      );
    }
    if (project.user_id !== user.id) {
      return NextResponse.json(
        { error: "forbidden", code: "FORBIDDEN" },
        { status: 403 },
      );
    }

    const document = project.document as Document;
    if (!document.manuscript) {
      return NextResponse.json(
        {
          error: "manuscript missing",
          code: "MANUSCRIPT_MISSING",
          message: "프로젝트에 분류된 원고가 없습니다 (분류 단계 미완)",
        },
        { status: 400 },
      );
    }

    // 5) 페이지네이션 호출
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
      console.error("[paginate] paginateBook failed", e);
      if (e instanceof PaginateError) {
        const status =
          e.code === "INPUT_INVALID" ||
          e.code === "VOCABULARY_EMPTY" ||
          e.code === "PATTERN_LIST_EMPTY"
            ? 400
            : e.code === "VALIDATION_FAILED"
              ? 422
              : 502;
        return NextResponse.json(
          {
            error: "paginate failed",
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
          { status },
        );
      }
      if (e instanceof LlmCallError) {
        return NextResponse.json(
          {
            error: "paginate failed",
            code: e.code,
            provider: e.provider,
            message: e.message,
          },
          { status: 502 },
        );
      }
      return NextResponse.json(
        {
          error: "paginate failed",
          code: "UNKNOWN",
          message: e instanceof Error ? e.message : "unknown",
        },
        { status: 500 },
      );
    }

    // 6) Document 갱신 + projects 업데이트
    const updatedDocument: Document = {
      ...document,
      pages: output.pages,
      styles: {
        paragraphStyles: output.stylesPatch.paragraphStyles ?? [],
        characterStyles: output.stylesPatch.characterStyles ?? [],
        colors: output.stylesPatch.colors ?? [],
        fonts: output.stylesPatch.fonts ?? [],
      },
    };

    const { error: updateError } = await supabase
      .from("projects")
      .update({
        document: updatedDocument,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (updateError) {
      console.error("[paginate] projects update 실패", updateError);
      return NextResponse.json(
        { error: "db update failed", code: "DB_UPDATE_FAILED" },
        { status: 500 },
      );
    }

    // 7) 크레딧 차감 — 실패해도 페이지네이션은 살아있음 (분류 라우트와 동일 정책)
    const cost = output.llm.rawCostUsd;
    const credits = usdToCredits(cost);
    try {
      await deductCredits({
        supabase,
        userId: user.id,
        credits,
        projectId,
        inputTokens: output.llm.inputTokens,
        outputTokens: output.llm.outputTokens,
        cacheReadTokens: output.llm.cacheReadTokens ?? 0,
        model: output.llm.model,
        rawCostUsd: cost,
        idempotencyKey,
      });
      console.log(
        `[paginate] ok user=${user.id.slice(0, 8)} project=${projectId} cost=$${cost} credits=${credits}`,
      );
    } catch (e) {
      console.error(
        "[paginate] deduct failed (pagination already saved)",
        e,
      );
      if (!(e instanceof DeductCreditsError)) {
        // 알려지지 않은 에러 — 그래도 페이지네이션 결과는 살아있음
      }
    }

    // 8) 응답
    const issuesByseverity = countBySeverity(output.validation.issues);
    return NextResponse.json({
      projectId,
      pageCount: output.pages.length,
      validation: {
        errorCount: issuesByseverity.error,
        warnCount: issuesByseverity.warn,
        infoCount: issuesByseverity.info,
      },
      llm: {
        model: output.llm.model,
        inputTokens: output.llm.inputTokens,
        outputTokens: output.llm.outputTokens,
        rawCostUsd: cost,
      },
    });
  } catch (e) {
    console.error("[paginate] unhandled", e);
    return NextResponse.json(
      {
        error: "internal",
        code: "UNHANDLED",
        message: e instanceof Error ? e.message : "unknown",
      },
      { status: 500 },
    );
  }
}

function countBySeverity(
  issues: ReadonlyArray<{ severity: "error" | "warn" | "info" }>,
): { error: number; warn: number; info: number } {
  const c = { error: 0, warn: 0, info: 0 };
  for (const i of issues) c[i.severity]++;
  return c;
}
