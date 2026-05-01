/**
 * Supabase 테이블 행 타입.
 * 마이그레이션(supabase/migrations/0001_init.sql)과 1:1로 맞춰져 있음.
 *
 * 마일스톤 1에서는 수동 정의. 데이터 모델이 안정화되면 마일스톤 4 즈음
 * `supabase gen types typescript`로 자동 생성으로 교체할 것.
 */

import type { Document } from "./document";

export type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  credit_balance: number;
  created_at: string;
};

export type CreditTransactionType = "purchase" | "usage" | "refund" | "bonus" | "signup";

export type CreditTransaction = {
  id: number;
  user_id: string;
  /** 양수 = 충전, 음수 = 차감 */
  delta: number;
  type: CreditTransactionType;
  related_project_id: string | null;
  related_payment_id: string | null;
  api_input_tokens: number | null;
  api_output_tokens: number | null;
  api_cache_read_tokens: number | null;
  model: string | null;
  raw_cost_usd: number | null;
  metadata: Record<string, unknown> | null;
  idempotency_key: string | null;
  created_at: string;
};

/**
 * projects 테이블의 한 행.
 *
 * 주의: 컬럼 이름은 SQL 따라 snake_case (created_at, design_tokens 등).
 * Document.designTokens (camelCase) 와 다른 위치 — 이건 DB 컬럼이라 SQL 컨벤션 따름.
 *
 * design_tokens 컬럼은 Document.designTokens 와 중복 저장된다.
 *   - design_tokens (top-level 컬럼): 검색/필터링·인덱싱 용도
 *   - document.designTokens (JSONB 안): 정합성·완전한 문서 객체의 일부
 * 두 곳을 항상 같이 업데이트해야 함. 이 책임은 lib/projects/ 의 헬퍼에서.
 */
export type Project = {
  id: string;
  user_id: string;
  title: string;
  thumbnail_url: string | null;
  format: Document["format"];
  design_tokens: Document["designTokens"] | null;
  document: Document;
  created_at: string;
  updated_at: string;
};
