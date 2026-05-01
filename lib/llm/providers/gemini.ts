/**
 * Gemini 어댑터 — Google Gemini API를 공통 LLM 추상화에 맞춤.
 *
 * SDK: @google/genai (v1.51+)
 *
 * 책임:
 *   1) Gemini API 호출 (ai.models.generateContent)
 *   2) FunctionCallingConfigMode.ANY 로 tool 호출 강제
 *   3) 재시도 (3회 exp backoff)
 *   4) 에러를 LlmCallError로 통일
 *   5) 토큰/비용 추적
 *
 * ─────────────────────────────────────────────────────────────
 * Anthropic vs Gemini의 차이점 (이 어댑터에서 흡수)
 * ─────────────────────────────────────────────────────────────
 *
 * 1) **System 프롬프트 처리**: Anthropic은 system 별도 필드. Gemini는 systemInstruction.
 * 2) **Tool 강제**: Anthropic은 tool_choice. Gemini는 toolConfig.functionCallingConfig.mode = ANY.
 * 3) **Tool 출력 추출**: Anthropic은 content blocks 배열에서 tool_use. Gemini는 functionCalls 배열.
 * 4) **JSON Schema**: Gemini는 JSON Schema의 일부만 지원 (subset). 1차 분류기 스키마는 단순해서 OK.
 * 5) **캐싱**: Gemini는 별도 API (ai.caches). 1차 미적용 — Anthropic의 inline cache_control 같은 게 없음.
 *    → 같은 시스템 프롬프트로 여러 번 호출해도 캐시 안 됨. 비용 약간 더 들 수 있음 (5-10%).
 * 6) **에러 형식**: Gemini SDK는 ApiError 또는 ClientError 등으로 throw. status 필드 있음.
 */

import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import type {
  Content,
  FunctionDeclaration,
  GenerateContentResponse,
  Schema,
} from "@google/genai";
import {
  type CallToolInput,
  type CallToolResult,
  LlmCallError,
} from "../types";
import { calculateCost } from "../cost";

// ─────────────────────────────────────────────────────────────
// 클라이언트
// ─────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "gemini-3.1-pro-preview";

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (typeof window !== "undefined") {
    throw new LlmCallError(
      "AUTH_FAILED",
      "Gemini 클라이언트는 서버에서만 호출 가능합니다.",
      { provider: "gemini" },
    );
  }
  // GOOGLE_API_KEY 또는 GEMINI_API_KEY (SDK가 둘 다 인식하지만 GOOGLE_API_KEY 우선)
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new LlmCallError(
      "AUTH_FAILED",
      "GEMINI_API_KEY (또는 GOOGLE_API_KEY) 환경변수가 설정되지 않았습니다.",
      { provider: "gemini" },
    );
  }
  if (!_client) {
    _client = new GoogleGenAI({ apiKey: key });
  }
  return _client;
}

// ─────────────────────────────────────────────────────────────
// 메인 함수
// ─────────────────────────────────────────────────────────────

export async function callToolGemini<TInput extends Record<string, unknown>>(
  input: CallToolInput<TInput>,
): Promise<CallToolResult<TInput>> {
  const client = getClient();
  const model = input.model ?? DEFAULT_MODEL;
  const maxRetries = input.maxRetries ?? 3;

  // messages → Gemini Content[] 변환
  // Gemini는 role이 "user" | "model" — assistant → model로 변환
  const contents: Content[] = input.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // Tool 변환 — JSON Schema → Gemini Schema
  // 1차 분류기 스키마는 단순해서 거의 그대로 통과.
  // 미래에 복잡한 스키마 들어오면 여기서 변환 보강.
  const functionDeclaration: FunctionDeclaration = {
    name: input.tool.name,
    description: input.tool.description,
    parameters: input.tool.input_schema as Schema,
  };

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response: GenerateContentResponse = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: input.system,
          maxOutputTokens: input.maxTokens,
          tools: [{ functionDeclarations: [functionDeclaration] }],
          toolConfig: {
            functionCallingConfig: {
              mode:
                input.forceToolUse !== false
                  ? FunctionCallingConfigMode.ANY
                  : FunctionCallingConfigMode.AUTO,
              ...(input.forceToolUse !== false
                ? { allowedFunctionNames: [input.tool.name] }
                : {}),
            },
          },
        },
      });

      // tool 호출 결과 추출
      // GenerateContentResponse.functionCalls는 helper getter
      const calls = response.functionCalls;
      const matchedCall = calls?.find((c) => c.name === input.tool.name);

      if (!matchedCall || !matchedCall.args) {
        // 모델이 tool 안 부르고 자유 텍스트로만 답한 경우
        const text = response.text ?? "(no text)";
        const preview = text.slice(0, 200);
        throw new LlmCallError(
          "TOOL_NOT_CALLED",
          `LLM이 tool을 호출하지 않았습니다. 응답: ${preview}`,
          { provider: "gemini", retriable: false },
        );
      }

      // 사용량 추출
      // response.usageMetadata 가 표준
      const meta = response.usageMetadata;
      const usage = {
        inputTokens: meta?.promptTokenCount ?? 0,
        outputTokens: meta?.candidatesTokenCount ?? 0,
        cacheReadTokens: meta?.cachedContentTokenCount ?? 0,
        cacheCreationTokens: 0, // Gemini는 명시적 캐시 생성 카운트 없음
      };

      const rawCostUsd = calculateCost(model, usage);

      // stopReason 추출 — candidates[0].finishReason
      const finishReason =
        response.candidates?.[0]?.finishReason ?? "UNKNOWN";

      return {
        output: matchedCall.args as TInput,
        provider: "gemini",
        model,
        usage,
        rawCostUsd,
        stopReason: String(finishReason),
      };
    } catch (e) {
      lastError = e;
      const wrapped = wrapGeminiError(e, input.callerLabel);
      const remaining = maxRetries - attempt;
      if (!wrapped.retriable || remaining === 0) {
        throw wrapped;
      }
      const delay = 500 * Math.pow(3, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw wrapGeminiError(lastError, input.callerLabel);
}

// ─────────────────────────────────────────────────────────────
// 에러 변환
// ─────────────────────────────────────────────────────────────

function wrapGeminiError(error: unknown, callerLabel?: string): LlmCallError {
  if (error instanceof LlmCallError) return error;

  const label = callerLabel ? `[${callerLabel}] ` : "";

  // @google/genai 의 에러는 클래스 직접 import가 어렵게 export됨.
  // status 필드가 있는지로 판별.
  const errAny = error as { status?: number; message?: string; name?: string };
  const status = errAny?.status;
  const message = errAny?.message ?? "unknown error";

  if (status !== undefined) {
    let code = "API_ERROR";
    let retriable = false;

    if (status === 401 || status === 403) {
      code = "AUTH_FAILED";
    } else if (status === 429) {
      code = "RATE_LIMITED";
      retriable = true;
    } else if (status === 503) {
      code = "OVERLOADED";
      retriable = true;
    } else if (status >= 500) {
      code = "SERVER_ERROR";
      retriable = true;
    } else if (status === 400) {
      const msg = message.toLowerCase();
      if (msg.includes("quota") || msg.includes("billing") || msg.includes("credit")) {
        code = "INSUFFICIENT_CREDIT";
      } else {
        code = "BAD_REQUEST";
      }
    }

    return new LlmCallError(
      code,
      `${label}Gemini API 오류 (${status}): ${message}`,
      { provider: "gemini", retriable, cause: error },
    );
  }

  // 네트워크 등 status 없는 에러
  return new LlmCallError(
    "UNKNOWN",
    `${label}Gemini 호출 실패: ${message}`,
    { provider: "gemini", retriable: true, cause: error },
  );
}
