/**
 * 토큰 → USD 비용 환산.
 *
 * client.ts 의 PRICING 표를 사용. 가격이 바뀌면 한 곳에서만 수정.
 *
 * 크레딧 환산은 별도 계층 (V2 가격 결정 후) — 여기서는 USD까지만.
 * lib/billing/credits.ts (M4 결제 시스템) 가 USD → 크레딧 변환.
 *
 * ─────────────────────────────────────────────────────────────
 * 캐시 토큰 가격 (2025년 Anthropic 공시)
 * ─────────────────────────────────────────────────────────────
 *
 * Sonnet 4.5 기준:
 *   - 입력 일반:      $3.00 / 1M
 *   - 입력 캐시 적중: $0.30 / 1M  (10%)
 *   - 입력 캐시 생성: $3.75 / 1M  (125%)
 *   - 출력:           $15.00 / 1M
 *
 * 한 번 캐싱하면 5분간 보존 → 한 사용자가 연속으로 분류·페이지네이션 호출하면
 * 시스템 프롬프트 비용이 1/10로 떨어짐.
 */

import { PRICING } from "./client";

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

/**
 * 호출당 USD 비용 계산.
 *
 * 입력 토큰 = (일반 입력) + (캐시 생성) + (캐시 적중)
 * Anthropic API의 input_tokens는 "일반 입력만" — 캐시 토큰은 별도 필드.
 *
 * 즉 총 비용:
 *   일반 입력 × $3.00 +
 *   캐시 생성 × $3.75 +
 *   캐시 적중 × $0.30 +
 *   출력      × $15.00
 *
 * 모두 1M 토큰 기준 가격이라 / 1_000_000.
 */
export function calculateCost(model: string, usage: Usage): number {
  const pricing = PRICING[model as keyof typeof PRICING];
  if (!pricing) {
    // 모르는 모델 — 보수적으로 sonnet 가격 기준으로 추정
    // (반환값이 0이면 비용 추적 시스템에서 누락된 줄 알게 됨, 그것보다는 추정값이 안전)
    const fallback = PRICING["claude-sonnet-4-5"];
    return computeFromPricing(fallback, usage);
  }
  return computeFromPricing(pricing, usage);
}

function computeFromPricing(
  pricing: { input: number; output: number; cacheRead: number; cacheWrite: number },
  usage: Usage,
): number {
  const cost =
    (usage.inputTokens * pricing.input +
      usage.outputTokens * pricing.output +
      usage.cacheReadTokens * pricing.cacheRead +
      usage.cacheCreationTokens * pricing.cacheWrite) /
    1_000_000;

  // 소수점 6자리까지만 (DB의 numeric(10,6)에 맞춤 — supabase 0001_init.sql)
  return Math.round(cost * 1_000_000) / 1_000_000;
}
