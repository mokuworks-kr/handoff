/**
 * LLM 추상화 — 공통 타입.
 *
 * 모든 프로바이더(anthropic, gemini, ...)가 같은 입출력 인터페이스로 동작한다.
 * 호출자(분류기, 페이지네이션, 자연어 편집)는 프로바이더를 알 필요 없음.
 *
 * 이게 §A 확장 축의 코드 표현 — "LLM 백엔드 갈아끼움 가능"이 5번째 축이라면
 * 이 파일이 그 축의 인터페이스 약속이다.
 */

// ─────────────────────────────────────────────────────────────
// 프로바이더
// ─────────────────────────────────────────────────────────────

/**
 * 지원하는 LLM 프로바이더 — 추가 시 여기 + lib/llm/providers/{name}.ts 박음.
 */
export type LlmProvider = "anthropic" | "gemini";

export const LLM_PROVIDERS: readonly LlmProvider[] = ["anthropic", "gemini"];

// ─────────────────────────────────────────────────────────────
// 입력
// ─────────────────────────────────────────────────────────────

/**
 * Tool 정의 — 모델이 호출할 수 있는 함수 1개의 스키마.
 *
 * input_schema는 JSON Schema 형식. 모든 프로바이더가 JSON Schema를 사용해
 * 추상화에 포함시킬 수 있음. 단 "약간씩 다른 dialect"에 주의 — 다음 처리:
 *   - Anthropic: standard JSON Schema, 거의 모든 키워드 지원
 *   - Gemini: subset of JSON Schema. type/properties/required/items/enum 등 핵심만.
 *     additionalProperties, allOf, oneOf 등은 무시되거나 에러.
 *
 * 우리 분류기 스키마는 단순해서 양쪽 다 OK. 미래에 복잡한 스키마가 필요해지면
 * 프로바이더별 변환 헬퍼 추가.
 */
export type LlmTool = {
  name: string;
  description: string;
  /** JSON Schema. 단순한 형태만 사용 권장 */
  input_schema: Record<string, unknown>;
};

/**
 * 사용자 메시지. role은 "user" 또는 "assistant".
 * (system은 별도 필드로 관리 — 프로바이더마다 처리가 달라서)
 *
 * 1차에선 단일 user 메시지만 사용. 미래에 multi-turn 자연어 편집에선 assistant도 사용.
 */
export type LlmMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * 호출 입력.
 *
 * provider 미지정 시 환경변수 LLM_PROVIDER 사용 (없으면 "anthropic").
 * model 미지정 시 프로바이더의 기본 모델 사용.
 */
export type CallToolInput<TInput extends Record<string, unknown>> = {
  /** 프로바이더 — 미지정 시 환경변수 LLM_PROVIDER */
  provider?: LlmProvider;
  /** 모델 ID — 미지정 시 프로바이더 기본 */
  model?: string;
  /** 시스템 프롬프트 */
  system: string;
  /** 사용자 메시지들 */
  messages: LlmMessage[];
  /** 모델이 호출할 tool */
  tool: LlmTool;
  /** 최대 출력 토큰. 분류기 ~4000, 페이지네이션 ~8000 권장 */
  maxTokens: number;
  /** 재시도 최대 횟수. 기본 3 */
  maxRetries?: number;
  /**
   * tool 호출 강제 여부. 기본 true (자유 텍스트 답변 안 받음).
   * false면 모델이 자유 응답할 수 있음 — 1차에선 거의 사용 X.
   */
  forceToolUse?: boolean;
  /** 호출 식별자 — 로깅/디버깅 (예: "classify-project-abc") */
  callerLabel?: string;
};

// ─────────────────────────────────────────────────────────────
// 출력
// ─────────────────────────────────────────────────────────────

/**
 * 토큰 사용량 — 비용 계산 + 크레딧 차감용.
 *
 * 모든 프로바이더에서 input/output은 항상 채워짐.
 * cache 토큰은 프로바이더가 캐싱을 지원하지 않으면 0.
 */
export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  /** 캐시 적중 (할인 적용된 입력) */
  cacheReadTokens: number;
  /** 캐시 생성 (캐시 만들 때 비용) — 일부 프로바이더만 */
  cacheCreationTokens: number;
};

export type CallToolResult<TInput extends Record<string, unknown>> = {
  /** 파싱된 tool input — 호출자 스키마에 맞춘 객체 */
  output: TInput;
  /** 프로바이더 (어디로 호출됐는지) */
  provider: LlmProvider;
  /** 사용 모델 ID (실제 호출된 모델) */
  model: string;
  /** 토큰 사용량 */
  usage: LlmUsage;
  /** USD 비용 — calculateCost로 계산됨 */
  rawCostUsd: number;
  /**
   * 종료 사유 — 정상 완료 / max_tokens / 안전 필터 등.
   * 프로바이더마다 값이 다르므로 raw 문자열로. 호출자가 "tool_use"/"end_turn" 등 알 필요 없음.
   */
  stopReason: string;
};

// ─────────────────────────────────────────────────────────────
// 에러
// ─────────────────────────────────────────────────────────────

/**
 * LLM 호출 에러 — 모든 프로바이더가 이 에러로 통일.
 *
 * code 필드로 호출자(API 라우트, UI)가 분기:
 *   - AUTH_FAILED       — API 키 무효 (401 등)
 *   - RATE_LIMITED      — 429
 *   - OVERLOADED        — 일시적 과부하 (Anthropic 529, Gemini 503)
 *   - SERVER_ERROR      — 5xx
 *   - BAD_REQUEST       — 잘못된 입력 (400) — 잔액 부족도 여기 포함될 수 있음
 *   - INSUFFICIENT_CREDIT — 명시적 잔액 부족 (가능하면 BAD_REQUEST에서 분리)
 *   - TOOL_NOT_CALLED   — 모델이 tool 호출 안 함 (forceToolUse=true인데 자유 답변)
 *   - UNKNOWN           — 위에 안 잡힌 것
 */
export class LlmCallError extends Error {
  readonly code: string;
  readonly provider?: LlmProvider;
  readonly retriable: boolean;
  readonly cause?: unknown;

  constructor(
    code: string,
    message: string,
    options: { provider?: LlmProvider; retriable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "LlmCallError";
    this.code = code;
    this.provider = options.provider;
    this.retriable = options.retriable ?? false;
    this.cause = options.cause;
  }
}
