/**
 * /api/lab/paginate — 페이지네이션 검증 lab 라우트.
 *
 * /lab/paginate 페이지가 부름. 이메일 화이트리스트로 보호 (LAB_ALLOWED_EMAILS).
 *
 * ─────────────────────────────────────────────────────────────
 * 본 라우트(/api/paginate) 와의 차이
 * ─────────────────────────────────────────────────────────────
 *
 * 1. **DB 저장 안 함** — lab 은 "시도해보고 결과만 보기".
 *    실제 적용은 본 흐름(/projects/[id] 의 "이 디자인으로 만들기" 버튼)을 통해.
 *
 * 2. **크레딧 차감 안 함** — 분류 lab(/api/classify) 과 동일 정책.
 *    LLM 호출 raw cost 는 응답에 노출해 사용자가 알게 함.
 *
 * 3. **풍부한 응답** — paginateBook 의 PaginateOutput 을 거의 그대로 반환:
 *    - pages: Page[] (SVG 미리보기용)
 *    - llmRaw: LlmBookOutput (rationale, slotBlockRefs, splitReason 메타)
 *    - validation: 모든 issues 풀 메시지 포함
 *    - llm: 토큰·비용 메타
 *
 * ─────────────────────────────────────────────────────────────
 * 입력
 * ─────────────────────────────────────────────────────────────
 *
 * application/json:
 *   { projectId: string }
 *
 * 분류 단계가 끝나서 document.manuscript 가 박혀있는 프로젝트만 가능.
 * 해당 프로젝트의 designTokens / format / artifactType 을 그대로 사용.
 *
 * ─────────────────────────────────────────────────────────────
 * 에러
 * ─────────────────────────────────────────────────────────────
 *
 *   401 — 비로그인 또는 화이트리스트 외
 *   400 — projectId 누락 / manuscript 없음 / 어휘 비어있음
 *   404 — 프로젝트 없음
 *   403 — 본인 프로젝트 아님 (RLS 가 막아 도달 가능성 낮음)
 *   422 — LLM 검증 실패 (issues 응답에 포함)
 *   502 — LLM 호출 실패
 *   500 — 기타 unhandled
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isLabAllowed } from "@/lib/auth/whitelist";
import { paginateBook } from "@/lib/paginate";
import { PaginateError } from "@/lib/paginate/types";
import { getPatternsForVocabulary } from "@/lib/layout/patterns";
import { LlmCallError } from "@/lib/llm";
import type { Document } from "@/lib/types/document";

// 페이지네이션은 LLM thinking 강제 + 30~40페이지 → 시간 길어질 수 있음.
// 본 라우트와 동일하게 60초 (Vercel Pro). Hobby 면 10초로 낮출 것.
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // 1) 인증 + 화이트리스트
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isLabAllowed(user.email)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 2) 입력 파싱
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

    // 3) 프로젝트 조회 + ownership + manuscript 존재
    //    DB 컬럼 user_id (스키마 기준). RLS 가 본인 행만 통과시키지만 명시 체크 유지.
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

    // 4) 패턴 카탈로그 좁히기 (어휘 → 콤포지션 후보)
    const vocabulary = document.designTokens.gridVocabulary ?? [];
    if (vocabulary.length === 0) {
      return NextResponse.json(
        {
          error: "vocabulary empty",
          code: "VOCABULARY_EMPTY",
          message: "designTokens.gridVocabulary 가 비어있습니다",
        },
        { status: 400 },
      );
    }
    const patterns = getPatternsForVocabulary(vocabulary);

    // 5) paginateBook 호출 — DB 저장 / 크레딧 차감 안 함
    let output;
    try {
      output = await paginateBook({
        manuscript: document.manuscript,
        designTokens: document.designTokens,
        patterns,
        format: document.format,
        artifactType: document.artifactType,
        callerLabel: `lab-paginate-${user.id.slice(0, 8)}-${projectId.slice(0, 8)}`,
      });
    } catch (e) {
      console.error("[lab-paginate] paginateBook failed", e);
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
            // 검증 실패한 경우 issues 풀 메시지 — lab UI 가 그대로 표시
            validation: e.validation
              ? {
                  hasError: e.validation.hasError,
                  validPageCount: e.validation.validPageCount,
                  issues: e.validation.issues,
                }
              : undefined,
            // 검증 실패한 경우 LLM 이 실제 뭘 출력했는지 디버그 표본 (첫 3페이지).
            // lab 전용 응답 — 본 라우트(/api/paginate)는 이 필드 없음.
            llmRawSample: e.llmRaw
              ? {
                  totalPages: e.llmRaw.pages.length,
                  firstPages: e.llmRaw.pages.slice(0, 3),
                  intentionalOmissions: e.llmRaw.intentionalOmissions ?? [],
                }
              : undefined,
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

    // 6) 풍부한 응답 — pages + llmRaw + validation 풀 메시지 + llm 메타
    console.log(
      `[lab-paginate] ok user=${user.id.slice(0, 8)} project=${projectId.slice(0, 8)} pages=${output.pages.length} cost=$${output.llm.rawCostUsd}`,
    );
    return NextResponse.json({
      projectId,
      // SVG 미리보기·콤포지션 슬러그 표시용
      pages: output.pages,
      // LLM raw 메타 — rationale, slotBlockRefs, splitReason, hiddenSlotIds 등
      llmRaw: output.llmRaw,
      // 검증 결과 — 모든 issues 풀 메시지
      validation: {
        hasError: output.validation.hasError,
        validPageCount: output.validation.validPageCount,
        issues: output.validation.issues,
      },
      // LLM 호출 메타
      llm: {
        model: output.llm.model,
        inputTokens: output.llm.inputTokens,
        outputTokens: output.llm.outputTokens,
        cacheReadTokens: output.llm.cacheReadTokens,
        rawCostUsd: output.llm.rawCostUsd,
        stopReason: output.llm.stopReason,
      },
      // 카탈로그 동기화 결과 — 디버깅용 (스타일 매칭 검증)
      stylesPatch: output.stylesPatch,
      // 사용자가 본 흐름으로 적용하기 전 단계라는 표시
      saved: false,
    });
  } catch (e) {
    console.error("[lab-paginate] unhandled", e);
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
