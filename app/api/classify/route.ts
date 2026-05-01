/**
 * /api/classify — 파일 업로드 또는 텍스트 → ClassifiedManuscript JSON.
 *
 * /lab/classify 페이지가 부름. 이메일 화이트리스트로 보호.
 *
 * 입력 (multipart/form-data):
 *   - file: 업로드 파일 (docx/pdf/pptx/hwpx)  또는
 *   - text: 평문 텍스트
 *   - filename (optional, text 모드에서)
 *
 * 출력:
 *   ClassifiedManuscript JSON
 *
 * 에러:
 *   401 — 비로그인 또는 화이트리스트 외
 *   400 — 파일/텍스트 누락
 *   413 — 파일 너무 큼 (Vercel 함수 4.5MB 초과). 라우트 도달 전 차단되므로 여기서 안 잡힘.
 *   422 — 파싱 실패 (지원하지 않는 형식 등)
 *   502 — LLM 호출 실패
 *   500 — 기타 unhandled (Vercel Logs에서 stack 확인)
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isLabAllowed } from "@/lib/auth/whitelist";
import { parseManuscript, ManuscriptParseError } from "@/lib/parsers";
import { classifyManuscript } from "@/lib/classify";
import { LlmCallError } from "@/lib/llm";

// Vercel 함수 설정 — Pro 플랜에서 60초까지. Hobby면 10초로 낮출 것.
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // 1) 인증
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isLabAllowed(user.email)) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401 },
      );
    }

    // 2) 입력 파싱
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (e) {
      console.error("[classify] formData parse failed", e);
      return NextResponse.json({ error: "invalid form data" }, { status: 400 });
    }

    const file = formData.get("file");
    const text = formData.get("text");
    const filenameField = formData.get("filename");

    // 3) 파서 라우터 호출
    let normalized;
    try {
      if (file && file instanceof File) {
        console.log(
          `[classify] file received name=${file.name} size=${file.size} type=${file.type}`,
        );
        const buffer = await file.arrayBuffer();
        normalized = await parseManuscript({
          kind: "file",
          buffer,
          filename: file.name,
        });
      } else if (typeof text === "string" && text.length > 0) {
        console.log(`[classify] text received len=${text.length}`);
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
      console.log(
        `[classify] parsed format=${normalized.source.format} blocks=${normalized.blocks.length}`,
      );
    } catch (e) {
      console.error("[classify] parse failed", e);
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
    try {
      const classified = await classifyManuscript(normalized, {
        callerLabel: `lab-${user.id.slice(0, 8)}`,
      });
      console.log(
        `[classify] ok sections=${classified.sections.length} cost=$${classified.classification?.rawCostUsd ?? 0}`,
      );
      return NextResponse.json(classified);
    } catch (e) {
      console.error("[classify] llm call failed", e);
      if (e instanceof LlmCallError) {
        return NextResponse.json(
          {
            error: "classify failed",
            code: e.code,
            provider: e.provider,
            message: e.message,
            partial: { ...normalized, sections: [] },
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
  } catch (e) {
    // 최상위 가드 — 위 try-catch가 못 잡은 모든 것
    console.error("[classify] unhandled", e);
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
