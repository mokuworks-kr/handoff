/**
 * 크레딧 차감 — Supabase RPC `deduct_credits` 호출 헬퍼.
 *
 * deduct_credits 함수는 SECURITY DEFINER 로 RLS 우회 + 원자적 차감을 보장
 * (supabase/migrations/0001_init.sql).
 *
 * 이 헬퍼의 책임:
 *   1) admin client 또는 server client 모두에서 호출 가능 (RPC가 SECURITY DEFINER라 anon도 OK)
 *   2) idempotency_key 강제 — 호출자가 반드시 명시
 *   3) 에러 케이스 분리:
 *       - INSUFFICIENT_CREDITS: 사용자에게 보여줄 수 있는 에러
 *       - PROFILE_NOT_FOUND: 시스템 에러 (트리거 누락 등)
 *       - 네트워크 등: 재시도 권장
 *   4) USD → 크레딧 환산은 호출자 쪽에서 수행 후 정수만 넘김 (이 함수는 USD 모름)
 *
 * 호출 예:
 *
 *   const cost = classifyResult.classification.rawCostUsd;
 *   const credits = usdToCredits(cost);
 *
 *   await deductCredits({
 *     supabase,
 *     userId: user.id,
 *     credits,
 *     projectId: newProject.id,
 *     inputTokens: classifyResult.classification.inputTokens,
 *     outputTokens: classifyResult.classification.outputTokens,
 *     cacheReadTokens: classifyResult.classification.cacheReadTokens ?? 0,
 *     model: classifyResult.classification.model,
 *     rawCostUsd: cost,
 *     idempotencyKey: `classify:${newProject.id}`,
 *   });
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type DeductCreditsInput = {
  supabase: SupabaseClient;
  userId: string;
  /** 차감할 크레딧 (양수, 0 허용) */
  credits: number;
  /** 관련 프로젝트 ID — 거래 원장 추적용 */
  projectId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  model: string;
  rawCostUsd: number;
  /**
   * 멱등키 — 같은 값으로 두 번 호출되면 두 번째는 no-op.
   * 분류기 호출 1회 = 1 idempotency_key.
   * 권장 형식: "{operation}:{projectId}" 또는 "{operation}:{userId}:{timestamp}"
   */
  idempotencyKey: string;
};

export class DeductCreditsError extends Error {
  readonly code:
    | "INSUFFICIENT_CREDITS"
    | "PROFILE_NOT_FOUND"
    | "INVALID_INPUT"
    | "RPC_FAILED"
    | "UNKNOWN";
  readonly cause?: unknown;

  constructor(
    code: DeductCreditsError["code"],
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "DeductCreditsError";
    this.code = code;
    this.cause = cause;
  }
}

/**
 * 크레딧 차감.
 *
 * 0 크레딧 차감은 RPC 호출 안 하고 바로 리턴 (no-op). 매우 작은 호출도
 * usdToCredits 가 최소 1 보장하지만, 정책 변경으로 0이 들어올 수 있어 가드.
 */
export async function deductCredits(input: DeductCreditsInput): Promise<void> {
  if (typeof window !== "undefined") {
    throw new DeductCreditsError(
      "RPC_FAILED",
      "deductCredits() 는 서버에서만 호출 가능합니다.",
    );
  }

  if (input.credits < 0 || !Number.isInteger(input.credits)) {
    throw new DeductCreditsError(
      "INVALID_INPUT",
      `credits는 0 이상의 정수여야 합니다 (got ${input.credits})`,
    );
  }

  if (input.credits === 0) return;

  if (!input.idempotencyKey || input.idempotencyKey.length === 0) {
    throw new DeductCreditsError(
      "INVALID_INPUT",
      "idempotencyKey는 필수입니다.",
    );
  }

  const { error } = await input.supabase.rpc("deduct_credits", {
    p_user_id: input.userId,
    p_credits: input.credits,
    p_project_id: input.projectId,
    p_input_tokens: input.inputTokens,
    p_output_tokens: input.outputTokens,
    p_cache_read_tokens: input.cacheReadTokens,
    p_model: input.model,
    p_raw_cost_usd: input.rawCostUsd,
    p_idempotency_key: input.idempotencyKey,
  });

  if (!error) return;

  // PG 함수가 raise exception 한 케이스 매핑
  const msg = error.message ?? "";
  if (msg.includes("INSUFFICIENT_CREDITS")) {
    throw new DeductCreditsError(
      "INSUFFICIENT_CREDITS",
      "크레딧이 부족합니다.",
      error,
    );
  }
  if (msg.includes("PROFILE_NOT_FOUND")) {
    throw new DeductCreditsError(
      "PROFILE_NOT_FOUND",
      "프로필을 찾을 수 없습니다. 가입 트리거가 누락됐을 가능성.",
      error,
    );
  }

  throw new DeductCreditsError(
    "RPC_FAILED",
    `deduct_credits RPC 호출 실패: ${msg}`,
    error,
  );
}

/**
 * 잔액 조회 — 차감 호출 전 사전 체크용.
 *
 * RLS에 의해 본인 행만 조회 가능. user 인증된 클라이언트에서 호출.
 * 잔액이 없으면 (profile 행 자체가 없으면) null.
 */
export async function getCreditBalance(
  supabase: SupabaseClient,
  userId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("credit_balance")
    .eq("id", userId)
    .single();

  if (error) return null;
  return data?.credit_balance ?? null;
}
