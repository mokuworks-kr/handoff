/**
 * /api/classify-and-create — production 입력 라우트.
 *
 * /lab/classify (검증·튜닝용)와 분리된 production 라우트.
 *
 * 흐름:
 *   1) 인증 (모든 로그인 사용자, 화이트리스트 X)
 *   2) 잔액 사전 체크 — MIN_CREDIT_BALANCE_FOR_CLASSIFY 미만이면 즉시 402
 *   3) 파일/텍스트 파싱 → NormalizedManuscript
 *   4) 분류기 호출 → ClassifiedManuscript (LLM 호출, 비용 발생)
 *   5) 프로젝트 생성 (Project row + Document 시드 + manuscript + origin)
 *   6) 크레딧 차감 (분류 비용 → 정수 크레딧)
 *   7) projectId 반환
 *
 * 차감 시점 결정 (Q1 추천):
 *   - 분류 호출 *후*, 실제 토큰 기반 정확 차감
 *   - 사전에는 MIN_CREDIT_BALANCE_FOR_CLASSIFY 만 체크
 *   - 분류 실패 시 차감 안 함 (당연)
 *   - 프로젝트 생성 실패 시: 분류는 했지만 결과를 못 살림 → 차감도 하지 않는 게 사용자에게 유리.
 *     단 LLM 비용은 이미 발생. 검증 단계라 작아 무시. 미래에 보정 필요하면 admin 통계로 추적.
 *
 * 멱등성:
 *   - idempotency_key = "classify:{projectId}"
 *   - 같은 프로젝트에 대해 두 번 차감 안 됨 (deduct_credits PG 함수가 보장)
 *   - 단 사용자가 같은 파일을 두 번 업로드하면 두 프로젝트가 생성됨 (이건 정상 — 별 케이스)
 *
 * 에러 코드 (status):
 *   401 — 비로그인
 *   402 — 잔액 부족
 *   400 — 입력 누락
 *   413 — 파일 큼 (Vercel 함수가 라우트 도달 전 차단)
 *   422 — 파싱 실패
 *   502 — LLM 호출 실패
 *   500 — 기타
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseManuscript, ManuscriptParseError } from "@/lib/parsers";
import { classifyManuscript } from "@/lib/classify";
import { LlmCallError } from "@/lib/llm";
import {
  usdToCredits,
  MIN_CREDIT_BALANCE_FOR_CLASSIFY,
} from "@/lib/credits/convert";
import { deductCredits, getCreditBalance, DeductCreditsError } from "@/lib/credits/deduct";
import { createProject, CreateProjectError } from "@/lib/projects/create";

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
      console.error("[classify-and-create] profile not found", { userId: user.id });
      return NextResponse.json(
        { error: "profile not found", code: "PROFILE_NOT_FOUND" },
        { status: 500 },
      );
    }
    if (balance < MIN_CREDIT_BALANCE_FOR_CLASSIFY) {
      return NextResponse.json(
        {
          error: "insufficient credits",
          code: "INSUFFICIENT_CREDITS",
          balance,
          required: MIN_CREDIT_BALANCE_FOR_CLASSIFY,
        },
        { status: 402 },
      );
    }

    // 3) 입력 파싱
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (e) {
      console.error("[classify-and-create] formData parse failed", e);
      return NextResponse.json({ error: "invalid form data" }, { status: 400 });
    }

    const file = formData.get("file");
    const text = formData.get("text");
    const filenameField = formData.get("filename");
    const titleField = formData.get("title"); // 사용자가 명시적으로 제목 입력 시
    const artifactTypeField = formData.get("artifactType"); // "bound" | "folded"

    let normalized;
    try {
      if (file && file instanceof File) {
        console.log(
          `[classify-and-create] file user=${user.id.slice(0, 8)} name=${file.name} size=${file.size}`,
        );
        const buffer = await file.arrayBuffer();
        normalized = await parseManuscript({
          kind: "file",
          buffer,
          filename: file.name,
        });
      } else if (typeof text === "string" && text.length > 0) {
        console.log(
          `[classify-and-create] text user=${user.id.slice(0, 8)} len=${text.length}`,
        );
        normalized = await parseManuscript({
          kind: "text",
          content: text,
          filename: typeof filenameField === "string" ? filenameField : undefined,
        });
      } else {
        return NextResponse.json(
          { error: "file or text required" },
          { status: 400 },
        );
      }
    } catch (e) {
      console.error("[classify-and-create] parse failed", e);
      if (e instanceof ManuscriptParseError) {
        return NextResponse.json(
          { error: "parse failed", code: e.code, message: e.message },
          { status: 422 },
        );
      }
      return NextResponse.json(
        {
          error: "parse failed",
          code: "PARSE_UNKNOWN",
          message: e instanceof Error ? e.message : "unknown",
        },
        { status: 500 },
      );
    }

    // 4) 분류기 호출
    let classified;
    try {
      classified = await classifyManuscript(normalized, {
        callerLabel: `production-${user.id.slice(0, 8)}`,
      });
    } catch (e) {
      console.error("[classify-and-create] llm call failed", e);
      if (e instanceof LlmCallError) {
        return NextResponse.json(
          {
            error: "classify failed",
            code: e.code,
            provider: e.provider,
            message: e.message,
          },
          { status: 502 },
        );
      }
      return NextResponse.json(
        {
          error: "classify failed",
          code: "UNKNOWN",
          message: e instanceof Error ? e.message : "unknown",
        },
        { status: 500 },
      );
    }

    // 5) 프로젝트 생성
    let project;
    try {
      const artifactType =
        artifactTypeField === "folded" ? "folded" : "bound";
      const userTitle =
        typeof titleField === "string" && titleField.trim().length > 0
          ? titleField.trim()
          : undefined;
      project = await createProject({
        supabase,
        userId: user.id,
        manuscript: classified,
        artifactType,
        title: userTitle,
      });
    } catch (e) {
      console.error("[classify-and-create] project create failed", e);
      if (e instanceof CreateProjectError) {
        return NextResponse.json(
          { error: "project create failed", code: e.code, message: e.message },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: "project create failed", code: "UNKNOWN" },
        { status: 500 },
      );
    }

    // 6) 크레딧 차감
    // 차감 실패해도 프로젝트는 이미 생성된 상태. 차감 실패는 시스템 에러로 로깅하되
    // 사용자 응답은 성공으로 (프로젝트 ID 반환). 차감 실패는 admin 추적용.
    if (classified.classification) {
      const cost = classified.classification.rawCostUsd;
      const credits = usdToCredits(cost);
      try {
        await deductCredits({
          supabase,
          userId: user.id,
          credits,
          projectId: project.projectId,
          inputTokens: classified.classification.inputTokens,
          outputTokens: classified.classification.outputTokens,
          cacheReadTokens: classified.classification.cacheReadTokens ?? 0,
          model: classified.classification.model,
          rawCostUsd: cost,
          idempotencyKey: `classify:${project.projectId}`,
        });
        console.log(
          `[classify-and-create] ok user=${user.id.slice(0, 8)} project=${project.projectId} cost=$${cost} credits=${credits}`,
        );
      } catch (e) {
        console.error(
          "[classify-and-create] deduct failed (project already created)",
          e,
        );
        // 차감 실패는 사용자 응답에 반영 안 함. 프로젝트는 이미 만들어졌고
        // 사용자는 다음 단계로 갈 수 있어야 함. admin 통계에서 추적.
        if (!(e instanceof DeductCreditsError)) {
          // 알려지지 않은 에러 — 그래도 프로젝트는 살아있음
        }
      }
    }

    // 7) 응답
    return NextResponse.json({
      projectId: project.projectId,
      title: project.title,
      manuscript: classified,
    });
  } catch (e) {
    console.error("[classify-and-create] unhandled", e);
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
