/**
 * 페이지네이션 LLM 타입 (M3b-2-a).
 *
 * ─────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────
 *
 * `paginateBook()` (M3b-2-c 의 진입점) 의 입출력 + LLM raw 출력 + 검증 결과.
 *
 * 다른 곳에 박힌 타입을 import 만 하고 새로 정의하지 않음:
 *   - PageBlueprint, CompositionPattern → @/lib/layout/composition
 *   - ClassifiedManuscript, Section     → @/lib/classify/types
 *   - DesignTokens                       → @/lib/types/design-tokens
 *   - Document, Page                     → @/lib/types/document
 *
 * 이 파일이 정의하는 건 그 위에 박히는 메타 타입들 (LLM 호출 입출력 형태,
 * 검증 결과, 진입점 시그니처).
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정 (앞 대화 7개 결정 박제)
 * ─────────────────────────────────────────────────────────────
 *
 * 1. **호출 1번에 책 전체** (PageBlueprint[] 통째로)
 *    - 시드 책자 30~40페이지 가정, gemini-2.5-pro maxTokens 65K 안
 *    - 책 호흡(rhythmGuide)을 LLM 이 시퀀스 단위로 봐야 자연스러움
 *
 * 2. **슬롯 콘텐츠는 블록 ID 참조** (§1 약속 시스템 강제)
 *    - LLM 이 텍스트를 직접 출력하지 않음. 분류된 매니스크립트의 블록 ID 만 참조
 *    - paginateBook() 이 블록 ID → 실제 콘텐츠 변환을 코드로 처리 → §1 약속 위반 자리 없음
 *    - 슬롯 종류별 매핑 (M3b-2-c 에서 박힘):
 *        text 슬롯  → 블록 ID 리스트 → 블록의 runs 평탄화한 문자열
 *        image 슬롯 → 블록 ID (image 블록 1개) → 그 블록의 src
 *        table 슬롯 → 블록 ID (table 블록 1개) → 그 블록의 cells
 *
 * 3. **페이지 분할 우선순위**: SeparatorBlock("page") 1순위 → 콘텐츠 양 자동 → 사용자 결합/분할(M3c)
 *
 * 4. **검증 5종** (§16.3) — M3b-2-d 에서 구현, 이 파일에는 결과 타입만:
 *    a) frames 좌표가 페이지 안 — realize() 가 자동 처리
 *    b) 콤포지션 슬러그가 카탈로그에 실재
 *    c) 슬롯 매핑이 패턴 정의와 일치
 *    d) 프레임 겹침 (1차 콤포지션은 안 겹치게 박혀서 실질 검증 불필요)
 *    e) 모든 블록이 어딘가에 들어감 또는 명시적 누락 — §1 약속 강제
 *
 * 5. **저장**: Document.pages 덮어쓰기 + Document.styles 동기화 (M3b-2-e 에서)
 */

import type {
  CompositionPattern,
  PageBlueprint,
} from "@/lib/layout/composition";
import type { ClassifiedManuscript } from "@/lib/classify/types";
import type { DesignTokens } from "@/lib/types/design-tokens";
import type { Document, Page } from "@/lib/types/document";

// ─────────────────────────────────────────────────────────────
// LLM raw 출력 — TOOL_SCHEMA 통과 직후
// ─────────────────────────────────────────────────────────────

/**
 * LLM 이 tool use 로 제출하는 페이지 1장의 raw 형태.
 *
 * `PageBlueprint` 와 비슷하지만 다음 차이:
 *   - LLM 단계에서는 슬롯 콘텐츠가 **블록 ID 참조** 로 들어옴 (§1 약속).
 *     예: { kind: "blockRefs", blockIds: ["b0042", "b0043", "b0044"] }
 *     paginateBook() 이 이걸 실제 PageBlueprint.content (블록 → 콘텐츠 매핑) 로 변환.
 *   - LLM 이 페이지 의도(role) 와 좌/우 페이지 위치 의도를 메타로 표현.
 *   - 페이지 분할 의도(어느 SeparatorBlock 을 따랐는지) 메타로 기록.
 *
 * 이 형태는 LLM 출력 디버깅·검증·M3c 사용자 편집용 메타데이터 보존이 목적.
 * realize() 에 들어갈 PageBlueprint 는 paginateBook() 이 별도 변환.
 */
export type LlmPageOutput = {
  /** 페이지 시퀀스에서의 위치 (1부터). LLM 이 채움 — 검증 시 1, 2, 3... 순차성 확인 */
  pageNumber: number;
  /** 콤포지션 슬러그 — ALL_PATTERNS 안에 실재해야 함 */
  pattern: string;
  /** 페이지 의도 — CompositionPattern.role 과 같은 enum. 검증·통계·rhythmGuide 분석용 */
  role: CompositionPattern["role"];
  /** 좌/우 페이지 위치. LLM 이 책 흐름 보고 결정. binding.ts (미래) 가 활용 */
  side: "left" | "right";
  /** colon 표기 변형 슬롯 선택값 (콤포지션의 variants 에 있는 ID/option) */
  variants?: Record<string, string>;
  /**
   * 슬롯별 블록 ID 매핑.
   * 예: { wide: ["b0042", "b0043"], narrow: ["b0046"] }
   * 빈 배열 = 슬롯에 콘텐츠 없음 (slot.optional 인 경우만 허용, 아니면 검증 실패).
   */
  slotBlockRefs: Record<string, string[]>;
  /**
   * LLM 이 일부 슬롯을 의도적으로 비웠을 때 (slot.optional=true).
   * 비어있는 slotBlockRefs 와 구분 — 명시적 의도가 있으면 검증 통과.
   */
  hiddenSlotIds?: string[];
  /**
   * 이 페이지가 어떤 분할 신호를 따랐는지의 메타.
   * - "page-separator": 원고의 SeparatorBlock("page") 따라 끊음 (1순위)
   * - "section-boundary": 분류된 섹션 경계
   * - "content-fit": 콘텐츠 양에 맞춰 LLM 이 분할
   * - "merged": 짧은 섹션을 인접 섹션과 결합
   * 검증 시 §1 약속 강제 — page-separator 무시한 케이스 잡음.
   */
  splitReason: "page-separator" | "section-boundary" | "content-fit" | "merged";
  /** 디버깅 메모 — LLM 이 짧게 의도 표현. 검증 통과 후에도 보존, M3c 사용자 편집 시 표시 */
  rationale?: string;
};

/**
 * LLM 의 책 1권 출력. tool use 의 input 형태.
 *
 * pages 배열의 길이는 책 페이지 수. 시드 5개 기준 4~40 범위.
 * 작성자 페이지 신호(SeparatorBlock("page"))의 갯수가 1순위 가이드.
 */
export type LlmBookOutput = {
  pages: LlmPageOutput[];
  /**
   * LLM 이 의도적으로 누락한 블록 + 사유.
   * §1 약속 강제: 침묵 누락은 검증 실패, 명시적 누락만 허용.
   * 예: [{ blockIds: ["b0099"], reason: "보고서 부록이라 본문에서 제외" }]
   */
  intentionalOmissions?: Array<{
    blockIds: string[];
    reason: string;
  }>;
};

// ─────────────────────────────────────────────────────────────
// 검증 결과 (§16.3 5종)
// ─────────────────────────────────────────────────────────────

/**
 * 검증 단계에서 발견된 이슈 1개.
 *
 * severity 별 처리:
 *   - error: 페이지 빌드 실패 — 사용자에게 에러 노출, 재시도 또는 수동 보정 필요
 *   - warn:  페이지는 빌드되되 디버깅 로그·M3c 표시. 빈 슬롯 등 자동 복구 가능 케이스
 *   - info:  통계용. 예: "어떤 슬롯이 비어 있다", "어떤 블록이 명시적 누락이다"
 *
 * code 분류 (검증 5종과 매핑):
 *   - INVALID_PATTERN_SLUG       (b) 카탈로그 밖 슬러그
 *   - PATTERN_NOT_IN_VOCABULARY  (b) 어휘 밖 콤포지션
 *   - SLOT_MISMATCH              (c) 슬롯 매핑이 패턴 정의와 안 맞음 (없는 슬롯, 필수 누락)
 *   - BLOCK_NOT_FOUND            (e) LLM 이 참조한 블록 ID 가 매니스크립트에 없음
 *   - BLOCK_ORPHANED             (e) 매니스크립트의 블록이 어떤 페이지에도 안 들어감
 *   - BLOCK_DUPLICATED           (e) 한 블록이 두 페이지 이상에 들어감
 *   - SPLIT_REASON_INCONSISTENT  (3) splitReason 이 "page-separator" 인데 직전 SeparatorBlock 없음
 *   - PAGE_NUMBER_GAP            메타 — pageNumber 가 1, 2, 3... 순차 아님
 *   - VARIANT_INVALID            variants 의 ID/value 가 콤포지션 정의와 불일치
 *   - INTENTIONAL_OMISSION       info — 의도된 누락 기록
 */
export type ValidationIssue = {
  severity: "error" | "warn" | "info";
  code: ValidationCode;
  /** 사람이 읽는 메시지 (한국어) */
  message: string;
  /** 관련 페이지 번호 (있으면) */
  pageNumber?: number;
  /** 관련 슬롯 ID (있으면) */
  slotId?: string;
  /** 관련 블록 ID (있으면) */
  blockId?: string;
};

export type ValidationCode =
  | "INVALID_PATTERN_SLUG"
  | "PATTERN_NOT_IN_VOCABULARY"
  | "SLOT_MISMATCH"
  | "BLOCK_NOT_FOUND"
  | "BLOCK_ORPHANED"
  | "BLOCK_DUPLICATED"
  | "SPLIT_REASON_INCONSISTENT"
  | "PAGE_NUMBER_GAP"
  | "VARIANT_INVALID"
  | "INTENTIONAL_OMISSION";

/**
 * 검증 결과 묶음.
 *
 * issues 가 비어있거나 모두 info/warn 이면 페이지 빌드 진행.
 * error 가 1개라도 있으면 paginateBook() 이 PaginateError 로 throw.
 */
export type ValidationResult = {
  issues: ValidationIssue[];
  /** error severity 가 1개 이상인지 (편의) */
  hasError: boolean;
  /** 검증 통과한 페이지 수 (issues 가 있어도 빌드된 페이지 갯수) */
  validPageCount: number;
};

// ─────────────────────────────────────────────────────────────
// paginateBook() 진입점 입출력
// ─────────────────────────────────────────────────────────────

/**
 * paginateBook() 입력.
 *
 * manuscript: ClassifiedManuscript — 분류 단계 결과.
 *   blocks 가 §1 약속 따라 원본 그대로. sections 가 의미 묶음.
 *
 * designTokens: 이 프로젝트의 디자인 토큰 인스턴스.
 *   gridVocabulary, rhythmGuide 가 페이지네이션 LLM 결정의 핵심 입력.
 *
 * patterns: 콤포지션 카탈로그 (이미 어휘로 좁혀진 상태).
 *   호출자가 getPatternsForVocabulary(designTokens.gridVocabulary) 결과를 넘김.
 *   페이지네이션이 어휘 검증을 다시 하지 않음 — 상위에서 보장.
 *
 * format: 페이지 판형 (A4 portrait 기본 등). Document.format 그대로.
 *
 * artifactType: "bound" | "folded" — 좌/우 페이지 미러링 결정에 영향.
 *
 * callerLabel: LLM 호출 디버깅·로그 식별자. 예: "paginate-{projectId}".
 *
 * idempotencyKey: 라우트의 크레딧 차감 멱등성용. lib/llm 자체는 멱등키 미지원.
 *
 * provider: 옵셔널 — 미지정 시 환경변수 LLM_PROVIDER (lib/llm 기본).
 *   1차 검증 단계에서 force gemini 등이 필요하면 명시적으로 줌.
 *
 * callTool: 테스트용 dependency injection. production 에서는 주입 안 함 — lib/llm 의 callTool 사용.
 *   테스트에서 LLM 응답을 모킹하려고 함수를 직접 주입 (ESM read-only export 우회).
 */
export type PaginateInput = {
  manuscript: ClassifiedManuscript;
  designTokens: DesignTokens;
  patterns: readonly CompositionPattern[];
  format: Document["format"];
  artifactType: "bound" | "folded";
  provider?: import("@/lib/llm").LlmProvider;
  callerLabel?: string;
  idempotencyKey?: string;
  /**
   * LLM 호출 함수 override. 테스트에서만 주입.
   * 기본값: lib/llm 의 callTool.
   * 시그니처는 lib/llm/types.ts 의 callTool 와 동일.
   */
  callTool?: <TInput extends Record<string, unknown>>(
    input: import("@/lib/llm").CallToolInput<TInput>,
  ) => Promise<import("@/lib/llm").CallToolResult<TInput>>;
};

/**
 * paginateBook() 출력.
 *
 * pages: 빌드된 Page[] — Document.pages 에 그대로 박을 수 있음.
 * stylesPatch: Document.styles 에 머지될 카탈로그 스냅샷.
 *   DesignTokens.print.* 에서 복사. 새 프로젝트 1회 동기화 (정책 §7-4).
 * llm: LLM 호출 메타 (model, tokens, cost) — 크레딧 차감 + 디버깅용.
 * validation: 검증 결과 — 사용자에게 warn/info 노출 또는 M3c 편집 힌트로 사용.
 *
 * **저장 책임은 호출자에게**. paginateBook() 은 DB 안 건드림.
 *   호출자(/api/paginate 라우트)가:
 *     1. paginateBook() 호출
 *     2. 결과 받아 Document.pages = pages, Document.styles = {...stylesPatch}
 *     3. projects 테이블 update
 *     4. 크레딧 차감 (output.llm 정보로)
 *   이 책임 분리가 §15.3 (분류 라우트) 패턴과 일관.
 */
export type PaginateOutput = {
  pages: Page[];
  stylesPatch: Document["styles"];
  llm: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    rawCostUsd: number;
    stopReason: string;
  };
  validation: ValidationResult;
};

// ─────────────────────────────────────────────────────────────
// 에러
// ─────────────────────────────────────────────────────────────

/**
 * paginateBook() 단계별 에러.
 *
 * 분류기의 ManuscriptParseError / LlmCallError 패턴 따름.
 * code 로 호출자(API 라우트, UI) 가 분기.
 */
export class PaginateError extends Error {
  readonly code:
    | "INPUT_INVALID"          // 입력 자체가 잘못됨 (빈 매니스크립트 등)
    | "VOCABULARY_EMPTY"        // designTokens.gridVocabulary 가 비어있음
    | "PATTERN_LIST_EMPTY"      // 어휘에 매칭되는 콤포지션 0개
    | "LLM_FAILED"              // LLM 호출 실패 (LlmCallError 래핑)
    | "VALIDATION_FAILED"       // 검증에서 error severity 1개 이상
    | "REALIZE_FAILED"          // realize() 호출 중 에러 (콤포지션 사용 오류)
    | "UNKNOWN";
  readonly cause?: unknown;
  readonly validation?: ValidationResult;

  constructor(
    code: PaginateError["code"],
    message: string,
    options: { cause?: unknown; validation?: ValidationResult } = {},
  ) {
    super(message);
    this.name = "PaginateError";
    this.code = code;
    this.cause = options.cause;
    this.validation = options.validation;
  }
}

// ─────────────────────────────────────────────────────────────
// 내부 유틸 타입 — paginateBook() 내부 단계별
// ─────────────────────────────────────────────────────────────

/**
 * LLM 출력의 LlmPageOutput → realize() 가 받을 수 있는 PageBlueprint 변환 결과.
 *
 * 변환 단계에서 슬롯 종류별 콘텐츠 구성:
 *   - text 슬롯  : 블록 ID 리스트 → 블록의 runs 합쳐 string 또는 TextRun[]
 *   - image 슬롯 : 블록 ID 1개 → 그 블록의 src/alt 추출 (placeholder 인 경우 빈 src)
 *   - table 슬롯 : 블록 ID 1개 → cells 변환 (NormalizedManuscript table → frames TableCell)
 *   - chart 슬롯 : 1차 미지원 (분류된 매니스크립트에 chart 블록 없음). 빈 콘텐츠.
 *
 * 이 단계에서 슬롯에 들어갈 블록이 슬롯 종류와 안 맞으면 (예: text 슬롯에 image 블록 ID)
 * SLOT_MISMATCH 검증 이슈 발생.
 */
export type ResolvedPageBlueprint = {
  /** LLM 메타 (검증 통과한 LlmPageOutput) — M3c 편집 시 원본 의도 추적용 */
  source: LlmPageOutput;
  /** realize() 에 넣을 수 있는 PageBlueprint */
  blueprint: PageBlueprint;
  /** 사용된 콤포지션 — realize() 호출 시 함께 넘김 */
  pattern: CompositionPattern;
};

// ─────────────────────────────────────────────────────────────
// 크레딧 정책
// ─────────────────────────────────────────────────────────────

/**
 * 페이지네이션 호출 전 잔액 사전 체크용 최소 임계값.
 *
 * 단일 출처는 lib/credits/convert.ts. 이 파일에서는 편의를 위해 re-export.
 * 분류기 패턴(MIN_CREDIT_BALANCE_FOR_CLASSIFY)과 동일.
 */
export { MIN_CREDIT_BALANCE_FOR_PAGINATE } from "@/lib/credits/convert";
