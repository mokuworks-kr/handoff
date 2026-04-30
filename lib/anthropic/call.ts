/**
 * Anthropic API 호출 헬퍼 — tool use 기반 structured output.
 *
 * 분류기, 페이지네이션, 자연어 편집 등 모든 LLM 호출의 공통 진입점.
 *
 * ─────────────────────────────────────────────────────────────
 * 책임
 * ─────────────────────────────────────────────────────────────
 *
 * 1) tool use 기반 structured output
 *    - 사용자가 정의한 JSON 스키마(tool input_schema)에 LLM이 맞춰 출력
 *    - 모델이 자유 텍스트로 답하는 게 아니라 tool 호출 형태로 답
 *    - 검증 가능, 파싱 안전
 *
 * 2) 재시도
 *    - 일시적 네트워크 오류, rate limit, 503 등은 재시도
 *    - 인증 실패(401), 잘못된 입력(400)은 즉시 실패
 *    - 최대 3회, exponential backoff (500ms / 1500ms / 4500ms)
 *
 * 3) 비용/토큰 추적
 *    - 모든 호출의 input/output/cache 토큰 반환
 *    - 호출자(분류기 등)가 받아서 credit_transactions에 기록
 *
 * 4) 시스템 프롬프트 캐싱
 *    - 시스템 프롬프트가 1024 토큰 이상이면 cache_control 자동 추가
 *    - 같은 시스템 프롬프트로 여러 번 호출 시 비용 절감 (cache read = 정가의 10%)
 *
 * ─────────────────────────────────────────────────────────────
 * 보안
 * ─────────────────────────────────────────────────────────────
 *
 * 절대 클라이언트(use client)에서 import 금지. 서버 전용.
 * ANTHROPIC_API_KEY는 NEXT_PUBLIC_ 접두사 없음 — 클라이언트 번들에 안 들어감.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { getAnthropicClient, MODELS } from "./client";
import { calculateCost } from "./cost";

// ─────────────────────────────────────────────────────────────
// 입력 / 출력 타입
// ─────────────────────────────────────────────────────────────

export type CallToolInput<TInput extends Record<string, unknown>> = {
  /** 모델 ID. 미지정 시 MODELS.primary */
  model?: string;
  /** 시스템 프롬프트 (1024+ 토큰이면 자동 캐싱) */
  system: string;
  /** 사용자 메시지들 */
  messages: MessageParam[];
  /** tool 정의 — LLM이 호출할 수 있는 함수 1개 (스키마 강제용) */
  tool: {
    name: string;
    description: string;
    input_schema: Tool["input_schema"];
  };
  /** 최대 출력 토큰. 분류기 ~2000, 페이지네이션 ~8000 정도 권장 */
  maxTokens: number;
  /** 재시도 최대 횟수. 기본 3 */
  maxRetries?: number;
  /** 추론 단서 — LLM이 항상 우리 tool을 호출하도록 강제 */
  forceToolUse?: boolean;
  /**
   * 호출 식별자 — 로깅/디버깅. 실패 시 어느 호출인지 식별.
   * 예: "classify-project-abc-123"
   */
  callerLabel?: string;
};

export type CallToolResult<TInput extends Record<string, unknown>> = {
  /** 파싱된 tool input — 우리 스키마에 맞춘 객체 */
  output: TInput;
  /** 사용된 토큰 (비용 계산 + 크레딧 차감용) */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
  /** 비용 (USD) */
  rawCostUsd: number;
  /** 사용 모델 */
  model: string;
  /** stop reason — 보통 "tool_use" */
  stopReason: Message["stop_reason"];
};

// ─────────────────────────────────────────────────────────────
// 메인 함수
// ─────────────────────────────────────────────────────────────

export async function callTool<TInput extends Record<string, unknown>>(
  input: CallToolInput<TInput>,
): Promise<CallToolResult<TInput>> {
  const client = getAnthropicClient();
  const model = input.model ?? MODELS.primary;
  const maxRetries = input.maxRetries ?? 3;

  // 시스템 프롬프트가 충분히 크면 캐싱 활성화
  // Anthropic 기준: 최소 1024 토큰. 대략 글자수 4000자 이상이면 1024 토큰 넘음.
  // 정확한 토큰 카운트는 호출 후에야 알 수 있으므로 길이 휴리스틱.
  const systemBlocks = input.system.length >= 4000
    ? [{ type: "text" as const, text: input.system, cache_control: { type: "ephemeral" as const } }]
    : input.system;

  // tool 정의
  const tools: Tool[] = [
    {
      name: input.tool.name,
      description: input.tool.description,
      input_schema: input.tool.input_schema,
    },
  ];

  // 호출 (재시도 포함)
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: input.maxTokens,
        system: systemBlocks,
        messages: input.messages,
        tools,
        // tool_choice 강제 — LLM이 자유 텍스트 답변하지 않고 반드시 우리 tool 호출
        tool_choice: input.forceToolUse !== false
          ? { type: "tool", name: input.tool.name }
          : { type: "auto" },
      });

      // tool_use 블록 추출
      const toolUseBlock = response.content.find(
        (block): block is ToolUseBlock => block.type === "tool_use" && block.name === input.tool.name,
      );

      if (!toolUseBlock) {
        // tool을 안 부른 경우 — 모델이 자유 텍스트로만 답한 경우.
        // forceToolUse가 true면 사실상 거의 안 일어남. 그래도 방어.
        const textBlock = response.content.find((b) => b.type === "text");
        const textPreview = textBlock && textBlock.type === "text"
          ? textBlock.text.slice(0, 200)
          : "(no text)";
        throw new AnthropicCallError(
          "TOOL_NOT_CALLED",
          `LLM이 tool을 호출하지 않았습니다. 응답: ${textPreview}`,
          { retriable: false },
        );
      }

      // 토큰 사용량
      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      };

      const rawCostUsd = calculateCost(model, usage);

      return {
        output: toolUseBlock.input as TInput,
        usage,
        rawCostUsd,
        model,
        stopReason: response.stop_reason,
      };
    } catch (e) {
      lastError = e;

      // 재시도 결정
      const retriable = isRetriable(e);
      const remaining = maxRetries - attempt;
      if (!retriable || remaining === 0) {
        // 최종 실패 — 의미 있는 에러로 감싸서 throw
        throw wrapError(e, input.callerLabel);
      }

      // exponential backoff: 500ms, 1500ms, 4500ms
      const delay = 500 * Math.pow(3, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // 도달 불가능 (위 루프가 throw 또는 return)
  throw wrapError(lastError, input.callerLabel);
}

// ─────────────────────────────────────────────────────────────
// 에러 분류
// ─────────────────────────────────────────────────────────────

/**
 * Anthropic SDK 에러 → 재시도 가능 여부.
 *
 * 재시도 가능: 네트워크 오류, 5xx, 429 (rate limit), 529 (overloaded)
 * 재시도 불가: 401 (인증), 400 (잘못된 입력), 우리 자체 검증 실패
 */
function isRetriable(error: unknown): boolean {
  if (error instanceof AnthropicCallError) {
    return error.retriable;
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    if (status === undefined) return true; // 네트워크 오류 가능성
    if (status === 429) return true;
    if (status === 529) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  // 일반 Error (네트워크 등) — 재시도
  return true;
}

function wrapError(error: unknown, callerLabel?: string): AnthropicCallError {
  if (error instanceof AnthropicCallError) return error;

  const label = callerLabel ? `[${callerLabel}] ` : "";

  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    let code = "API_ERROR";
    if (status === 401) code = "AUTH_FAILED";
    else if (status === 429) code = "RATE_LIMITED";
    else if (status === 529) code = "OVERLOADED";
    else if (status && status >= 500) code = "SERVER_ERROR";
    else if (status === 400) code = "BAD_REQUEST";

    return new AnthropicCallError(
      code,
      `${label}Anthropic API 오류 (${status}): ${error.message}`,
      { retriable: false, cause: error },
    );
  }

  const message = error instanceof Error ? error.message : "unknown error";
  return new AnthropicCallError(
    "UNKNOWN",
    `${label}LLM 호출 실패: ${message}`,
    { retriable: false, cause: error },
  );
}

// ─────────────────────────────────────────────────────────────
// 에러 클래스
// ─────────────────────────────────────────────────────────────

export class AnthropicCallError extends Error {
  readonly code: string;
  readonly retriable: boolean;
  readonly cause?: unknown;

  constructor(
    code: string,
    message: string,
    options: { retriable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "AnthropicCallError";
    this.code = code;
    this.retriable = options.retriable ?? false;
    this.cause = options.cause;
  }
}
