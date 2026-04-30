/**
 * ClassifiedManuscript — 분류기 출력 형태.
 *
 * NormalizedManuscript의 블록들을 의미 단위(섹션)로 묶은 결과.
 * 페이지네이션 LLM(M3b)이 이 위에서 동작.
 *
 * ─────────────────────────────────────────────────────────────
 * 설계 정책 (이전 대화에서 박힌 결정)
 * ─────────────────────────────────────────────────────────────
 *
 * 1) **kind는 약하게 닫힌 enum (6개 + other)**
 *    cover-like / timeline-like / people-like / data-like /
 *    narrative-like / list-like / other
 *
 *    "콘텐츠의 모양"이지 "비즈니스 도메인"이 아님.
 *    환경 보고서의 "탄소 배출량 표"도 IR의 "재무제표"도 모두 data-like.
 *    1차 타깃이 IR이지만 카탈로그·매뉴얼 등 다른 도메인에 와도 같은 분류기가 작동.
 *
 * 2) **label은 자유 자연어**
 *    LLM이 본 그대로 한국어로 ("연혁", "주요 사업", "환경 평가 방법론" 등)
 *    페이지네이션 LLM의 디자인 결정에 직접 영향 안 줌. 사용자 미리보기·검색·디버깅용.
 *
 * 3) **hints는 자유 메타데이터**
 *    페이지네이션이 콤포지션 고를 때 도움 되는 신호 (항목 개수, 표 유무 등)
 *    하지만 hints에 의존하지는 않음. 없어도 페이지네이션 가능.
 *
 * 4) **분류 라벨이 페이지 디자인을 직접 결정하지 않음**
 *    "timeline-like" 라고 무조건 같은 콤포지션 X. 페이지네이션 LLM이
 *    DesignTokens.gridVocabulary 안에서 적절한 비율을 골라 디자인.
 *
 * 5) **분류는 사용자가 손볼 수 있어야 함**
 *    LLM이 70% 맞히면 사용자가 30% 보정. range를 드래그로 조정,
 *    kind를 드롭다운으로 변경, label 직접 수정. (M3a-3에서 UI 구현)
 *
 * 6) **§1 약속 — 원고 안 다듬음**
 *    분류기는 "라벨만 붙임". 블록을 자르거나 합치거나 다시 쓰지 않음.
 *    range는 NormalizedManuscript의 블록을 그대로 가리키는 인덱스 범위.
 *
 * ─────────────────────────────────────────────────────────────
 * 라이프사이클
 * ─────────────────────────────────────────────────────────────
 *
 *   NormalizedManuscript (lib/parsers/normalized.ts)
 *      ↓ classifyManuscript() — Claude tool use
 *   ClassifiedManuscript (이 파일)
 *      ↓ 사용자 미리보기 + 보정 (M3a-3)
 *      ↓ 저장: Document.manuscript (M3a-3 끝에)
 *      ↓ 페이지네이션 LLM (M3b)
 *   PageBlueprint[]
 */

import type { Block, NormalizedManuscript } from "@/lib/parsers/normalized";

// ─────────────────────────────────────────────────────────────
// kind enum
// ─────────────────────────────────────────────────────────────

/**
 * 섹션의 "콘텐츠 모양".
 *
 * 약하게 닫힘 — 7개 enum + other가 escape hatch.
 *
 * 각 kind의 의미와 전형적 예시:
 *   cover-like     — 표지스러운 (회사명 + 문서명, 타이틀 슬라이드, 챕터 시작 페이지)
 *   timeline-like  — 시간순 항목 (연혁, 로드맵, 분기별 실적)
 *   people-like    — 사람들의 묶음 (팀 소개, 임원, 자문위원)
 *   data-like      — 수치/표 위주 (재무제표, KPI, 통계 표)
 *   narrative-like — 긴 본문 (회사 소개, 사업 비전, 미션)
 *   list-like      — 이름·항목 리스트 (제품 라인업, 사업 영역, 인증 목록)
 *   other          — 위 어느 것도 아님 (연락처, 부록, 약관, 차트 단독 등)
 */
export type SectionKind =
  | "cover-like"
  | "timeline-like"
  | "people-like"
  | "data-like"
  | "narrative-like"
  | "list-like"
  | "other";

export const SECTION_KINDS: readonly SectionKind[] = [
  "cover-like",
  "timeline-like",
  "people-like",
  "data-like",
  "narrative-like",
  "list-like",
  "other",
];

/**
 * UI 색깔 매핑. 미리보기 페이지에서 섹션 색깔별로 표시할 때 사용.
 * 무채색 + 옅은 액센트 — 스펙 §11 색상 팔레트 정책 따름.
 *
 * 디자인 의도가 아니라 "디버그 시각화용" 임을 잊지 말 것.
 * 본 제품 UI에서는 다른 색 매핑이 들어갈 수 있음.
 */
export const SECTION_KIND_COLORS: Record<SectionKind, { bg: string; text: string; label: string }> = {
  "cover-like":     { bg: "#FEF3C7", text: "#92400E", label: "표지" },
  "timeline-like":  { bg: "#DBEAFE", text: "#1E40AF", label: "타임라인" },
  "people-like":    { bg: "#FCE7F3", text: "#9F1239", label: "인물" },
  "data-like":      { bg: "#D1FAE5", text: "#065F46", label: "데이터" },
  "narrative-like": { bg: "#E0E7FF", text: "#3730A3", label: "본문" },
  "list-like":      { bg: "#FEF9C3", text: "#854D0E", label: "리스트" },
  "other":          { bg: "#F3F4F6", text: "#374151", label: "기타" },
};

// ─────────────────────────────────────────────────────────────
// hints
// ─────────────────────────────────────────────────────────────

/**
 * 페이지네이션 LLM에 도움 되는 메타데이터.
 *
 * 모든 필드 옵셔널 — 분류기가 채울 수 있는 만큼 채움.
 * 페이지네이션은 hints가 비어도 동작 가능 (블록 자체를 다시 봄).
 *
 * hints 종류는 의도적으로 작게 시작. 실제 페이지네이션 작업에서 필요해지는
 * 신호만 추가 (M3b 진행 중 보강).
 */
export type SectionHints = {
  /** 항목 개수 — list/timeline/people 류에서 의미. 표지/본문에선 보통 미설정 */
  itemCount?: number;
  /** 표가 포함되어 있나 (data-like에서 흔함) */
  hasTable?: boolean;
  /** 가장 큰 표의 크기 — "4x10" 같은 문자열 */
  largestTable?: string;
  /** 이미지가 포함되어 있나 (people-like 또는 cover-like에서 흔함) */
  hasImage?: boolean;
  /** 연도가 포함되어 있나 (timeline-like 강한 신호) */
  hasYears?: boolean;
  /** 명시적 제목(HeadingBlock)이 섹션 시작에 있나 */
  hasTitle?: boolean;
  /** 섹션 안의 단락 총 글자 수 — 페이지 분할 추정용 */
  totalCharCount?: number;
};

// ─────────────────────────────────────────────────────────────
// Section
// ─────────────────────────────────────────────────────────────

/**
 * 의미 단위로 묶인 섹션 1개.
 *
 * range는 NormalizedManuscript.blocks의 블록 ID로 표현.
 * "blockIds" 가 아니라 "fromId"/"toId" 한 쌍을 쓰는 이유:
 *   - 인접한 블록 묶음만 섹션이 됨 (jumpy section은 의미 없음)
 *   - 사용자가 드래그로 경계 조정할 때 두 끝점만 옮기면 됨
 *   - 직렬화/저장 시 더 컴팩트
 *
 * 두 ID 사이의 모든 블록이 섹션에 포함됨 (inclusive).
 */
export type Section = {
  /** 섹션 ID — UUID 또는 "s001" 식 짧은 식별자. 분류기가 부여 */
  id: string;
  /** 섹션 시작 블록 ID (NormalizedManuscript.blocks의 어느 한 블록의 id) */
  fromBlockId: string;
  /** 섹션 끝 블록 ID (inclusive) */
  toBlockId: string;
  /** 콘텐츠 모양 */
  kind: SectionKind;
  /** 사람이 읽는 라벨 — 자유 자연어 (예: "연혁", "주요 사업", "팀") */
  label: string;
  /** 한 줄 설명 — 분류기가 본 섹션의 요약. 디버깅/미리보기 */
  summary: string;
  /** 페이지네이션 보조 신호 */
  hints?: SectionHints;
};

/**
 * 섹션 ID 생성 — "s001", "s002" ...
 * 4자리 패딩 (블록 ID와 동일한 패턴 — 일관성)
 */
export function sectionId(index: number): string {
  if (index < 0) throw new Error(`sectionId index must be >= 0 (got ${index})`);
  return `s${String(index + 1).padStart(4, "0")}`;
}

// ─────────────────────────────────────────────────────────────
// ClassifiedManuscript
// ─────────────────────────────────────────────────────────────

/**
 * 분류된 원고.
 *
 * NormalizedManuscript를 그대로 품고, 그 위에 sections 배열을 얹은 형태.
 * 페이지네이션 LLM과 사용자 미리보기 둘 다 이 한 객체만 보면 됨.
 *
 * 정합성 규칙 (런타임 검증은 lib/classify/validate.ts에서 — M3a-2 후속):
 *   1) sections는 빈 배열 가능 (분류 실패 시), 단 그 경우 warnings에 메시지
 *   2) 각 section의 fromBlockId / toBlockId는 normalized.blocks에 실재해야 함
 *   3) sections가 normalized.blocks 전체를 *덮을 필요는 없음* — 분류 못한 블록은
 *      "unclassified"로 남음. 페이지네이션이 알아서 처리 (보통 "other"로 간주)
 *   4) 두 섹션이 겹치면 안 됨 (한 블록은 최대 한 섹션에만 속함)
 *   5) sections는 fromBlockId의 블록 순서로 정렬 (시각적 순서)
 *
 * 저장 위치: Document.manuscript (이전 대화 결정 — 옵션 A)
 */
export type ClassifiedManuscript = NormalizedManuscript & {
  /** 분류 결과 섹션들 */
  sections: Section[];

  /**
   * 분류 호출 메타데이터 — 디버깅·비용 추적·재분류 결정용.
   * 분류기 호출이 실패해도 부분 결과를 저장할 수 있게 옵셔널.
   */
  classification?: {
    /** 사용 모델 ID (예: "claude-sonnet-4-5") */
    model: string;
    /** 입력 토큰 */
    inputTokens: number;
    /** 출력 토큰 */
    outputTokens: number;
    /** 캐시 적중 토큰 (있으면) */
    cacheReadTokens?: number;
    /** 호출 시각 ISO */
    classifiedAt: string;
    /** 비용 (USD) — 디버깅·관리자 화면용 */
    rawCostUsd: number;
  };
};

// ─────────────────────────────────────────────────────────────
// 헬퍼 — 블록 인덱스 ↔ 블록 ID
// ─────────────────────────────────────────────────────────────

/**
 * 블록 ID로 블록 객체 찾기.
 * O(N) — 분류기 미리보기는 섹션 수가 적어 충분. 페이지네이션 같이 더 빈번한 곳에서
 * 쓸 거면 미리 Map<id, Block> 만들어 쓸 것.
 */
export function findBlockById(
  blocks: Block[],
  id: string,
): Block | undefined {
  return blocks.find((b) => b.id === id);
}

/**
 * 한 섹션이 포함하는 블록들을 순서대로 반환.
 * 섹션의 fromBlockId/toBlockId가 blocks에 없으면 빈 배열.
 */
export function blocksInSection(
  blocks: Block[],
  section: Pick<Section, "fromBlockId" | "toBlockId">,
): Block[] {
  const fromIdx = blocks.findIndex((b) => b.id === section.fromBlockId);
  const toIdx = blocks.findIndex((b) => b.id === section.toBlockId);
  if (fromIdx === -1 || toIdx === -1 || toIdx < fromIdx) return [];
  return blocks.slice(fromIdx, toIdx + 1);
}
