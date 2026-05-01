/**
 * 통합 LLM 호출 진입점.
 *
 * 호출자(분류기, 페이지네이션, 자연어 편집 등)가 부르는 단 하나의 함수.
 * 프로바이더 선택은 input.provider > LLM_PROVIDER 환경변수 > 기본값("gemini") 순.
 *
 * 사용 예:
 *
 *   const result = await callTool({
 *     system: "...",
 *     messages: [{ role: "user", content: "..." }],
 *     tool: { name: "submit", description: "...", input_schema: {...} },
 *     maxTokens: 4000,
 *     forceToolUse: true,
 *     callerLabel: "classify",
 *   });
 *
 *   // result.output 으로 tool input(JSON) 받음
 *   // result.usage / result.rawCostUsd 로 비용 추적
 *
 * 프로바이더 강제 지정 (검증 단계에서 두 모델 비교):
 *
 *   await callTool({ provider: "anthropic", ... })
 *   await callTool({ provider: "gemini", ... })
 */

import {
  type CallToolInput,
  type CallToolResult,
  type LlmProvider,
  LLM_PROVIDERS,
  LlmCallError,
} from "./types";
import { callToolAnthropic } from "./providers/anthropic";
import { callToolGemini } from "./providers/gemini";

/**
 * 환경변수 또는 기본값으로 프로바이더 결정.
 *
 * 결정 순서:
 *   1) 명시적 input.provider
 *   2) LLM_PROVIDER 환경변수
 *   3) 기본값 "gemini" — 사용자 결제 막힘으로 인한 1차 선택
 *
 * 미래에 결제 풀리면 LLM_PROVIDER=anthropic 으로 전체 시스템 즉시 전환 가능.
 */
function resolveProvider(explicit?: LlmProvider): LlmProvider {
  if (explicit) return explicit;

  const envValue = process.env.LLM_PROVIDER;
  if (envValue && (LLM_PROVIDERS as readonly string[]).includes(envValue)) {
    return envValue as LlmProvider;
  }

  return "gemini";
}

export async function callTool<TInput extends Record<string, unknown>>(
  input: CallToolInput<TInput>,
): Promise<CallToolResult<TInput>> {
  const provider = resolveProvider(input.provider);

  switch (provider) {
    case "anthropic":
      return callToolAnthropic(input);
    case "gemini":
      return callToolGemini(input);
    default: {
      // exhaustive 체크 — 새 프로바이더 추가 시 컴파일 에러로 잡힘
      const _exhaustive: never = provider;
      throw new LlmCallError(
        "UNKNOWN",
        `지원하지 않는 프로바이더: ${_exhaustive}`,
      );
    }
  }
}
