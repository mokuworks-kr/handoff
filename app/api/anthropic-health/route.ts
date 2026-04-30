/**
 * Anthropic 헬스체크 — API 키 살아있고 호출 성공하는지.
 *
 * 분류기 본격 호출 전에 사용자가 브라우저에서 URL 한 번 열어 OK 확인.
 * 비용: 입력 ~50토큰 + 출력 ~10토큰 = $0.0003 (~0.4원). 실질 무료.
 *
 * 보안: 결과 응답에 토큰 사용량/비용은 포함, API 키 자체는 절대 노출 X.
 *
 * 배포 후 검증:
 *   GET https://your-domain/api/anthropic-health
 *   → { "ok": true, "model": "...", "responsePreview": "...", "usage": {...} }
 */

import { NextResponse } from "next/server";
import { callTool, AnthropicCallError } from "@/lib/anthropic/call";
import { MODELS } from "@/lib/anthropic/client";

export async function GET() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY not set" },
      { status: 500 },
    );
  }

  try {
    // 매우 작은 tool call — "ping" 입력 받아 "pong" 출력
    const result = await callTool<{ message: string }>({
      model: MODELS.primary,
      system: "You are a health check responder.",
      messages: [{ role: "user", content: "Reply with the word 'pong'." }],
      tool: {
        name: "respond",
        description: "Respond with a single word.",
        input_schema: {
          type: "object",
          properties: {
            message: { type: "string", description: "Single word response" },
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
      model: result.model,
      responsePreview: result.output.message,
      usage: result.usage,
      rawCostUsd: result.rawCostUsd,
      stopReason: result.stopReason,
    });
  } catch (e) {
    if (e instanceof AnthropicCallError) {
      return NextResponse.json(
        { ok: false, code: e.code, message: e.message },
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
