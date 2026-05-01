/**
 * 모델 가격 표 + 비용 계산.
 *
 * 모든 프로바이더의 모델 가격을 한 표에 모음 — 모델 ID로 조회.
 * 가격이 바뀌면 이 파일에서만 수정.
 *
 * 단가는 1M 토큰 기준 USD.
 *
 * ─────────────────────────────────────────────────────────────
 * 가격 출처 (2026-04-30 시점)
 * ─────────────────────────────────────────────────────────────
 *
 * Anthropic:
 *   https://docs.anthropic.com/en/docs/about-claude/pricing
 *
 * Google Gemini:
 *   https://ai.google.dev/gemini-api/docs/pricing
 *
 * Gemini 3.1 Pro의 context-tier 가격 — 1M 미만 토큰까지는 $2/$12,
 * 1M 초과 시 더 비싸짐. 우리는 1M 이내라 단순화.
 */

import type { LlmUsage } from "./types";

type Pricing = {
  /** 일반 입력 (1M 토큰당 USD) */
  input: number;
  /** 출력 (1M 토큰당 USD) */
  output: number;
  /** 캐시 적중 (할인 적용) */
  cacheRead: number;
  /** 캐시 생성 (가끔 더 비쌈) */
  cacheWrite: number;
};

export const PRICING: Record<string, Pricing> = {
  // Anthropic Claude
  "claude-sonnet-4-5": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-opus-4": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },

  // Google Gemini
  "gemini-3.1-pro-preview": {
    input: 2,
    output: 12,
    // Gemini는 캐싱 가격을 별도 청구. 1차에선 캐싱 미적용이라 0으로 둠.
    // 캐싱 적용 시 약 $0.50/$2.50 (입력의 25%) — 미래에 활성화하면 갱신.
    cacheRead: 0,
    cacheWrite: 0,
  },
  "gemini-3-flash": {
    input: 0.3,
    output: 2.5,
    cacheRead: 0,
    cacheWrite: 0,
  },
  "gemini-2.5-pro": {
    input: 1.25,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
  },
  "gemini-2.5-flash": {
    input: 0.3,
    output: 2.5,
    cacheRead: 0,
    cacheWrite: 0,
  },
};

/**
 * 호출당 USD 비용 계산.
 *
 * Anthropic의 input_tokens는 "캐시 외 일반 입력만" — 캐시 토큰은 별도 필드.
 * Gemini도 동일하게 분리됨.
 *
 * 따라서 총 입력 토큰 = inputTokens + cacheReadTokens + cacheCreationTokens.
 * 각각 다른 단가 적용.
 *
 * 모르는 모델은 "claude-sonnet-4-5" 가격으로 fallback (보수적 추정).
 */
export function calculateCost(model: string, usage: LlmUsage): number {
  const pricing = PRICING[model] ?? PRICING["claude-sonnet-4-5"];

  const cost =
    (usage.inputTokens * pricing.input +
      usage.outputTokens * pricing.output +
      usage.cacheReadTokens * pricing.cacheRead +
      usage.cacheCreationTokens * pricing.cacheWrite) /
    1_000_000;

  // 소수점 6자리까지 (DB의 numeric(10,6)에 맞춤)
  return Math.round(cost * 1_000_000) / 1_000_000;
}
