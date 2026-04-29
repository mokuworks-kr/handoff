/**
 * Anthropic API 클라이언트 싱글톤.
 *
 * 마일스톤 1에서는 헬스체크용으로만 쓰이고, 실제 LLM 호출은 마일스톤 3
 * (페이지네이션) 부터 본격 시작.
 *
 * 모델 ID는 한 곳에서 관리해 마이그레이션을 쉽게 한다.
 */

import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (typeof window !== "undefined") {
    throw new Error("Anthropic 클라이언트는 서버에서만 호출 가능합니다.");
  }
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
  }
  return _client;
}

/**
 * 사용 모델 ID. 스펙: Claude Sonnet 4.5.
 *
 * 마일스톤 3 본격 호출 시점에 docs.claude.com에서 정확한 식별자를 한 번 더 검증할 것.
 */
export const MODELS = {
  /** 메인 작업용 (페이지네이션, 자연어 수정) */
  primary: "claude-sonnet-4-5",
} as const;

/** 토큰당 단가 (USD per 1M tokens) — 2025년 기준 공시가 */
export const PRICING = {
  "claude-sonnet-4-5": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
} as const;
