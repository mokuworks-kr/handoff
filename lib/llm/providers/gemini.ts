/**
 * Gemini 어댑터 — Google Gemini API를 공통 LLM 추상화에 맞춤.
 *
 * SDK: @google/genai (v1.51+)
 *
 * 책임:
 *   1) Gemini API 호출 (ai.models.generateContent)
 *   2) FunctionCallingConfigMode.ANY 로 tool 호출 강제
 *   3) thinking 모델 처리 (모델별 화이트리스트 — 일부 모델은 thinking 강제)
 *   4) 재시도 (3회 exp backoff)
 *   5) 에러를 LlmCallError로 통일
 *   6) 토큰/비용 추적
 *
 * ─────────────────────────────────────────────────────────────
 * Anthropic vs Gemini의 차이점 (이 어댑터에서 흡수)
 * ─────────────────────────────────────────────────────────────
 *
 * 1) **System 프롬프트 처리**: Anthropic은 system 별도 필드. Gemini는 systemInstruction.
 * 2) **Tool 강제**: Anthropic은 tool_choice. Gemini는 toolConfig.functionCallingConfig.mode = ANY.
 * 3) **Tool 출력 추출**: Anthropic은 content blocks 배열에서 tool_use. Gemini는 functionCalls 배열.
 * 4) **JSON Schema**: Gemini는 JSON Schema의 일부만 지원 (subset). 1차 분류기 스키마는 단순해서 OK.
 * 5) **캐싱**: Gemini는 별도 API (ai.caches). 1차 미적용.
 * 6) **Thinking 모델 함정** ← M3a-2 검증에서 발견
 *    공식 문서 (https://ai.google.dev/gemini-api/docs/thinking) 기준:
 *    - thinking 끄기 가능: gemini-2.5-flash, gemini-2.5-flash-lite
 *    - thinking 끄기 불가: gemini-2.5-pro, gemini-3.x 전체
 *    분류 작업은 reasoning이 그렇게 강하게 필요하지 않으므로,
 *    thinking 끌 수 있는 가벼운 모델(gemini-2.5-flash)을 기본값으로 둠.
 *    Pro reasoning이 필요해지면 호출 시 model 명시 + maxTokens 충분히 잡기.
 * 7) **에러 형식**: Gemini SDK는 ApiError 또는 ClientError 등으로 throw. status 필드 있음.
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

// gemini-2.5-flash: thinking 끌 수 있고 가격이 저렴 ($0.30/$2.50).
// 분류 작업은 reasoning이 강하게 필요하지 않아 Flash로 충분.
// 부족하면 호출 시 model 파라미터로 gemini-2.5-pro 또는 gemini-3.1-pro-preview 명시.
const DEFAULT_MODEL = "gemini-2.5-flash";

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (typeof window !== "undefined") {
    throw new LlmCallError(
      "AUTH_FAILED",
      "Gemini 클라이언트는 서버에서만 호출 가능합니다.",
      { provider: "gemini" },
    );
  }
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
// thinking 끌 수 있는 모델 화이트리스트
// ─────────────────────────────────────────────────────────────

/**
 * 이 모델이 thinkingBudget=0 을 받아주는지.
 *
 * Google 공식 문서 (https://ai.google.dev/gemini-api/docs/thinking) 기준:
 *   - 끌 수 있음: gemini-2.5-flash, gemini-2.5-flash-lite
 *   - 끌 수 없음 (Budget 0 → INVALID_ARGUMENT): gemini-2.5-pro, 모든 gemini-3.x
 *
 * 화이트리스트 패턴 — prefix 매칭으로 미래 변종 (gemini-2.5-flash-002 등) 흡수.
 */
function supportsDisablingThinking(model: string): boolean {
  if (model.startsWith("gemini-2.5-flash-lite")) return true;
  if (model.startsWith("gemini-2.5-flash")) return true;
  return false;
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
  const label = input.callerLabel ?? "gemini";

  // messages → Gemini Content[] 변환
  const contents: Content[] = input.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const functionDeclaration: FunctionDeclaration = {
    name: input.tool.name,
    description: input.tool.description,
    parameters: input.tool.input_schema as Schema,
  };

  // thinking 끌 수 있는 모델만 0으로. 못 끄는 모델은 thinkingConfig 자체를 빼서 SDK 기본값 따름.
  const thinkingConfig = supportsDisablingThinking(model)
    ? { thinkingBudget: 0 }
    : undefined;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `[${label}] gemini call attempt=${attempt + 1}/${maxRetries + 1} model=${model} maxTokens=${input.maxTokens} thinkingDisabled=${thinkingConfig !== undefined}`,
      );

      const response: GenerateContentResponse = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: input.system,
          maxOutputTokens: input.maxTokens,
          ...(thinkingConfig ? { thinkingConfig } : {}),
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

      // tool 호출 결과 추출 — 안전하게 try로 감쌈 (SDK getter가 throw 가능)
      let calls: GenerateContentResponse["functionCalls"];
      let textPreview = "";
      let finishReason: string = "UNKNOWN";
      try {
        calls = response.functionCalls;
        textPreview = (response.text ?? "").slice(0, 200);
        finishReason = String(response.candidates?.[0]?.finishReason ?? "UNKNOWN");
      } catch (extractErr) {
        console.error(`[${label}] response 추출 실패`, extractErr);
        throw new LlmCallError(
          "BAD_RESPONSE",
          `Gemini 응답 파싱 실패: ${extractErr instanceof Error ? extractErr.message : "unknown"}`,
          { provider: "gemini", retriable: true, cause: extractErr },
        );
      }

      console.log(
        `[${label}] gemini response stopReason=${finishReason} functionCalls=${calls?.length ?? 0} textLen=${textPreview.length}`,
      );

      const matchedCall = calls?.find((c) => c.name === input.tool.name);

      if (!matchedCall || !matchedCall.args) {
        const reason = finishReason === "MAX_TOKENS"
          ? "응답이 maxTokens 한도에서 끊김 (thinking 강제 모델이라면 maxTokens를 더 크게 잡아야 함)"
          : `tool 호출 없음, 자유 텍스트 응답: ${textPreview}`;
        throw new LlmCallError(
          "TOOL_NOT_CALLED",
          `LLM이 tool을 호출하지 않았습니다. ${reason}`,
          { provider: "gemini", retriable: false },
        );
      }

      const meta = response.usageMetadata;
      const usage = {
        inputTokens: meta?.promptTokenCount ?? 0,
        outputTokens: meta?.candidatesTokenCount ?? 0,
        cacheReadTokens: meta?.cachedContentTokenCount ?? 0,
        cacheCreationTokens: 0,
      };

      const rawCostUsd = calculateCost(model, usage);

      return {
        output: matchedCall.args as TInput,
        provider: "gemini",
        model,
        usage,
        rawCostUsd,
        stopReason: finishReason,
      };
    } catch (e) {
      lastError = e;
      const wrapped = wrapGeminiError(e, label);
      console.error(
        `[${label}] gemini error attempt=${attempt + 1} code=${wrapped.code} retriable=${wrapped.retriable} message=${wrapped.message}`,
      );
      const remaining = maxRetries - attempt;
      if (!wrapped.retriable || remaining === 0) {
        throw wrapped;
      }
      const delay = 500 * Math.pow(3, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw wrapGeminiError(lastError, label);
}

// ─────────────────────────────────────────────────────────────
// 에러 변환
// ─────────────────────────────────────────────────────────────

function wrapGeminiError(error: unknown, callerLabel?: string): LlmCallError {
  if (error instanceof LlmCallError) return error;

  const label = callerLabel ? `[${callerLabel}] ` : "";

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

  return new LlmCallError(
    "UNKNOWN",
    `${label}Gemini 호출 실패: ${message}`,
    { provider: "gemini", retriable: true, cause: error },
  );
}
