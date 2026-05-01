/**
 * Anthropic 어댑터 — 공통 LLM 추상화에 맞춘 Claude 호출 구현.
 *
 * 책임:
 *   1) Anthropic SDK 호출
 *   2) 시스템 프롬프트 캐싱 자동 활성화 (4000자+)
 *   3) 재시도 (3회 exp backoff)
 *   4) 에러를 LlmCallError로 통일
 *   5) 토큰/비용 추적
 *
 * 사용자 결제 막힘 상황에서 1차 활성화 안 됨 (Gemini 사용).
 * 미래에 결제 풀리면 환경변수 LLM_PROVIDER=anthropic 으로 즉시 부활.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import {
  type CallToolInput,
  type CallToolResult,
  LlmCallError,
} from "../types";
import { calculateCost } from "../cost";

// ─────────────────────────────────────────────────────────────
// 클라이언트
// ─────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "claude-sonnet-4-5";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (typeof window !== "undefined") {
    throw new LlmCallError(
      "AUTH_FAILED",
      "Anthropic 클라이언트는 서버에서만 호출 가능합니다.",
      { provider: "anthropic" },
    );
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new LlmCallError(
      "AUTH_FAILED",
      "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.",
      { provider: "anthropic" },
    );
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

// ─────────────────────────────────────────────────────────────
// 메인 함수
// ─────────────────────────────────────────────────────────────

export async function callToolAnthropic<TInput extends Record<string, unknown>>(
  input: CallToolInput<TInput>,
): Promise<CallToolResult<TInput>> {
  const client = getClient();
  const model = input.model ?? DEFAULT_MODEL;
  const maxRetries = input.maxRetries ?? 3;

  // 시스템 프롬프트 캐싱 (4000자+ — 1024 토큰 휴리스틱)
  const systemBlocks = input.system.length >= 4000
    ? [
        {
          type: "text" as const,
          text: input.system,
          cache_control: { type: "ephemeral" as const },
        },
      ]
    : input.system;

  // tool 변환 — Anthropic SDK 형식
  const tools: Tool[] = [
    {
      name: input.tool.name,
      description: input.tool.description,
      input_schema: input.tool.input_schema as Tool["input_schema"],
    },
  ];

  // messages 변환
  const messages: MessageParam[] = input.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: input.maxTokens,
        system: systemBlocks,
        messages,
        tools,
        tool_choice:
          input.forceToolUse !== false
            ? { type: "tool", name: input.tool.name }
            : { type: "auto" },
      });

      const toolUseBlock = response.content.find(
        (block): block is ToolUseBlock =>
          block.type === "tool_use" && block.name === input.tool.name,
      );

      if (!toolUseBlock) {
        const textBlock = response.content.find((b) => b.type === "text");
        const preview =
          textBlock && textBlock.type === "text"
            ? textBlock.text.slice(0, 200)
            : "(no text)";
        throw new LlmCallError(
          "TOOL_NOT_CALLED",
          `LLM이 tool을 호출하지 않았습니다. 응답: ${preview}`,
          { provider: "anthropic", retriable: false },
        );
      }

      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      };

      const rawCostUsd = calculateCost(model, usage);

      return {
        output: toolUseBlock.input as TInput,
        provider: "anthropic",
        model,
        usage,
        rawCostUsd,
        stopReason: response.stop_reason ?? "unknown",
      };
    } catch (e) {
      lastError = e;
      const wrapped = wrapAnthropicError(e, input.callerLabel);
      const remaining = maxRetries - attempt;
      if (!wrapped.retriable || remaining === 0) {
        throw wrapped;
      }
      // exponential backoff: 500ms, 1500ms, 4500ms
      const delay = 500 * Math.pow(3, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw wrapAnthropicError(lastError, input.callerLabel);
}

// ─────────────────────────────────────────────────────────────
// 에러 변환
// ─────────────────────────────────────────────────────────────

function wrapAnthropicError(error: unknown, callerLabel?: string): LlmCallError {
  if (error instanceof LlmCallError) return error;

  const label = callerLabel ? `[${callerLabel}] ` : "";

  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    let code = "API_ERROR";
    let retriable = false;

    if (status === undefined) {
      code = "UNKNOWN";
      retriable = true; // 네트워크 오류 가능성
    } else if (status === 401) {
      code = "AUTH_FAILED";
    } else if (status === 429) {
      code = "RATE_LIMITED";
      retriable = true;
    } else if (status === 529) {
      code = "OVERLOADED";
      retriable = true;
    } else if (status >= 500) {
      code = "SERVER_ERROR";
      retriable = true;
    } else if (status === 400) {
      // Anthropic은 잔액 부족도 400으로 옴 — 메시지 파싱
      const msg = error.message.toLowerCase();
      if (msg.includes("credit") || msg.includes("balance")) {
        code = "INSUFFICIENT_CREDIT";
      } else {
        code = "BAD_REQUEST";
      }
    }

    return new LlmCallError(
      code,
      `${label}Anthropic API 오류 (${status}): ${error.message}`,
      { provider: "anthropic", retriable, cause: error },
    );
  }

  const message = error instanceof Error ? error.message : "unknown error";
  return new LlmCallError(
    "UNKNOWN",
    `${label}Anthropic 호출 실패: ${message}`,
    { provider: "anthropic", retriable: true, cause: error },
  );
}
