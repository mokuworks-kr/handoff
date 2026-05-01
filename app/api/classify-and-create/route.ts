/**
 * /api/classify-and-create — production 입력 라우트.
 *
 * 입력 방식 (M3a-3-2c 변경):
 *   - 파일 직접 업로드 ❌ (Vercel 4.5MB 한도)
 *   - Storage 경로 받기 ✅ (클라이언트가 미리 Storage에 직접 업로드)
 *   - 텍스트 입력은 그대로 (작아서 body로 보내도 됨)
 *
 * 흐름:
 *   1) 인증 (모든 로그인 사용자)
 *   2) 잔액 체크 — MIN_CREDIT_BALANCE_FOR_CLASSIFY
 *   3) 입력 분기:
 *      - storagePath → admin client 로 Storage 다운로드 → 파싱
 *      - text → 직접 파싱
 *   4) 분류기 호출 → ClassifiedManuscript
 *   5) 프로젝트 생성
 *   6) 크레딧 차감
 *   7) projectId 반환
 *
 * Storage 경로 검증:
 *   - 클라이언트가 보낸 path가 user_id 로 시작하는지 확인 (다른 사용자 파일 접근 차단)
 *   - admin client 는 RLS 우회하므로 이 검증이 필수
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

    // 3) 입력 — JSON body
    let body: {
      storagePath?: string;
      filename?: string;
      text?: string;
      title?: string;
      artifactType?: "bound" | "folded";
    };
    try {
      body = await request.json();
    } catch (e) {
      console.error("[classify-and-create] body parse failed", e);
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }

    let normalized;
    try {
      if (body.storagePath) {
        // 경로 검증 — user_id 로 시작해야 함 (다른 사용자 파일 접근 차단)
        const expectedPrefix = `${user.id}/`;
        if (!body.storagePath.startsWith(expectedPrefix)) {
          console.warn(
            `[classify-and-create] path traversal attempt user=${user.id} path=${body.storagePath}`,
          );
          return NextResponse.json(
            { error: "invalid storage path", code: "INVALID_PATH" },
            { status: 403 },
          );
        }

        // Storage 에서 다운로드 (admin client — RLS 우회)
        const admin = createAdminClient();
        const { data: blob, error: dlError } = await admin.storage
          .from("originals")
          .download(body.storagePath);

        if (dlError || !blob) {
          console.error(
            "[classify-and-create] storage download failed",
            dlError,
            body.storagePath,
          );
          return NextResponse.json(
            {
              error: "storage download failed",
              code: "DOWNLOAD_FAILED",
              message: dlError?.message,
            },
            { status: 500 },
          );
        }

        const buffer = await blob.arrayBuffer();
        // filename 추출 — body.filename 우선, 없으면 storagePath의 마지막 세그먼트
        const filename =
          body.filename ?? body.storagePath.split("/").pop() ?? "uploaded";
        console.log(
          `[classify-and-create] storage user=${user.id.slice(0, 8)} path=${body.storagePath} size=${buffer.byteLength}`,
        );
        normalized = await parseManuscript({
          kind: "file",
          buffer,
          filename,
        });
      } else if (typeof body.text === "string" && body.text.length > 0) {
        console.log(
          `[classify-and-create] text user=${user.id.slice(0, 8)} len=${body.text.length}`,
        );
        normalized = await parseManuscript({
          kind: "text",
          content: body.text,
          filename: body.filename,
        });
      } else {
        return NextResponse.json(
          { error: "storagePath or text required" },
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
      const artifactType = body.artifactType === "folded" ? "folded" : "bound";
      const userTitle =
        typeof body.title === "string" && body.title.trim().length > 0
          ? body.title.trim()
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
