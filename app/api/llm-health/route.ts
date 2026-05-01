// 기존 import 아래에
export const maxDuration = 30;
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // ... 기존 그대로
}

/**
 * LLM 헬스체크 — API 키 살아있고 호출 성공하는지.
 *
 * 분류기 본격 호출 전에 사용자가 브라우저에서 URL 한 번 열어 OK 확인.
 *
 * 사용:
 *   GET /api/llm-health           — 기본 프로바이더 (LLM_PROVIDER 환경변수 또는 "gemini")
 *   GET /api/llm-health?provider=gemini      — Gemini 명시
 *   GET /api/llm-health?provider=anthropic   — Anthropic 명시
 *
 * 정상 응답:
 *   { "ok": true, "provider": "gemini", "model": "...", "responsePreview": "pong", ... }
 *
 * 비용: 입력 ~50 + 출력 ~10 토큰 = $0.0001~0.0003. 실질 무료.
 * 보안: API 키는 응답에 절대 노출 X.
 */

import { NextResponse, type NextRequest } from "next/server";
import { callTool, LlmCallError, LLM_PROVIDERS, type LlmProvider } from "@/lib/llm";

export async function GET(request: NextRequest) {
  // ?provider= 쿼리 파라미터
  const url = new URL(request.url);
  const providerParam = url.searchParams.get("provider");

  let provider: LlmProvider | undefined;
  if (providerParam) {
    if (!(LLM_PROVIDERS as readonly string[]).includes(providerParam)) {
      return NextResponse.json(
        {
          ok: false,
          error: `unknown provider: ${providerParam}`,
          allowed: LLM_PROVIDERS,
        },
        { status: 400 },
      );
    }
    provider = providerParam as LlmProvider;
  }

  try {
    const result = await callTool<{ message: string }>({
      provider,
      system: "You are a health check responder.",
      messages: [{ role: "user", content: "Reply with the word 'pong'." }],
      tool: {
        name: "respond",
        description: "Respond with a single word.",
        input_schema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Single word response",
            },
          },
          required: ["message"],
        },
      },
      maxTokens: 100,
      forceToolUse: true,
      callerLabel: "health-check",
    });

    return NextResponse.json({
      ok: true,
      provider: result.provider,
      model: result.model,
      responsePreview: result.output.message,
      usage: result.usage,
      rawCostUsd: result.rawCostUsd,
      stopReason: result.stopReason,
    });
  } catch (e) {
    if (e instanceof LlmCallError) {
      return NextResponse.json(
        {
          ok: false,
          provider: e.provider,
          code: e.code,
          message: e.message,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: "UNKNOWN",
        message: e instanceof Error ? e.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
