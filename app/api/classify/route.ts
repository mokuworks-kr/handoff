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
 *   422 — 파싱 실패 (지원하지 않는 형식 등)
 *   502 — Anthropic 호출 실패
 *   500 — 기타
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isLabAllowed } from "@/lib/auth/whitelist";
import { parseManuscript, ManuscriptParseError } from "@/lib/parsers";
import { classifyManuscript } from "@/lib/classify";
import { AnthropicCallError } from "@/lib/anthropic/call";

export async function POST(request: NextRequest) {
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
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  const text = formData.get("text");
  const filenameField = formData.get("filename");

  // 3) 파서 라우터 호출
  let normalized;
  try {
    if (file && file instanceof File) {
      const buffer = await file.arrayBuffer();
      normalized = await parseManuscript({
        kind: "file",
        buffer,
        filename: file.name,
      });
    } else if (typeof text === "string" && text.length > 0) {
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
      callerLabel: `lab-${user.id}`,
    });
    return NextResponse.json(classified);
  } catch (e) {
    if (e instanceof AnthropicCallError) {
      return NextResponse.json(
        {
          error: "classify failed",
          code: e.code,
          message: e.message,
          // 부분 결과: 분류 실패해도 normalized는 보냄 (사용자가 원고 추출은 봤다는 신호)
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
}
