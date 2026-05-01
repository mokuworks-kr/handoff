/**
 * 콤포지션 패턴 카탈로그 — 1차.
 *
 * ─────────────────────────────────────────────────────────────
 * 카탈로그 구성 (M3b-1)
 * ─────────────────────────────────────────────────────────────
 *
 * default.md 어휘 [[12], [6,6], [8,4], [4,4,4], [3,3,3,3]] 안의 콤포지션 10개:
 *
 *   비율 [12]        — full-text                       (텍스트 풀폭)
 *                    full-image                       (이미지 풀블리드)
 *   비율 [6,6]       — halves-text-text                (두 단 텍스트)
 *                    halves-text-image                (텍스트 + 이미지 균등)
 *   비율 [8,4]       — wide-narrow-text-image  ★ var  (제품 카탈로그 케이스)
 *                    wide-narrow-table-text   ★ var  (재무제표 + 캡션)
 *   비율 [4,4,4]     — thirds-text-text-text           (비전/미션/가치)
 *                    thirds-image-image-image         (제품 3개 사진)
 *   비율 [3,3,3,3]   — quarters-text-text-text-text    (분기별 실적, 4단계)
 *                    quarters-image-image-image-image (임원 4명, 시설 4개)
 *
 * ★ var = asymmetryDirection variants (wide-left / wide-right) 보유.
 *
 * ─────────────────────────────────────────────────────────────
 * 슬러그 명명 정책 (의미적)
 * ─────────────────────────────────────────────────────────────
 *
 * 슬러그가 비율 숫자가 아니라 의미("full", "halves", "wide-narrow", "thirds",
 * "quarters")로 박힘. 디버깅 로그/LLM 출력에서 슬러그만 봐도 페이지 모양 즉시 잡힘.
 *
 * 1차 시스템은 default.md 어휘 안의 비율(정수 배열)을 직접 사용.
 * 미래에 다른 columns 그리드(예: 8단/16단)를 받으려면 그 시점에 일반화 검토.
 * 1차에 안 박는 이유 — YAGNI + §3/§14 ("1차는 default.md 만으로 진행").
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정 부합
 * ─────────────────────────────────────────────────────────────
 *
 * §11 약속 1번 (어휘는 책 단위 고정): 모든 콤포지션이 default 어휘의 한 비율과 매칭.
 *   같은 비율의 여러 콤포지션은 슬롯 종류 차이로 다양화 (§11 약속 2번).
 *
 * §16.5 동적 주입 정책: 페이지네이션 LLM (M3b-2) 호출 시 이 카탈로그가 user message
 *   로 주입됨. 디자인이 늘어도 (§16.8 시나리오) 프롬프트는 1개 그대로.
 *
 * §16.6 후보 좁히기: getPatternsForVocabulary() 가 어휘로 1차 좁힘.
 *   getPatternsByRole() 가 role 로 2차 좁힘. 결과는 5~7개 (§16.6 범위 안).
 *
 * ─────────────────────────────────────────────────────────────
 * 미래 확장
 * ─────────────────────────────────────────────────────────────
 *
 * 1차 시드 5개 검증 후 부족한 조합이 발견되면 추가:
 *   - 슬롯 혼합 (thirds-image-text-image, halves-image-text 등)
 *   - 표/차트 조합 (full-table, halves-text-chart)
 *   - 비대칭 3슬롯 이상 ([6,3,3], [4,4,2,2] — 새 어휘 + 콤포지션)
 *   - 새 columns 그리드 (8단/16단/6단) — 시스템 일반화 작업 필요
 *
 * 추가 시 코드 변경:
 *   1) 새 패턴 파일 추가 (lib/layout/patterns/<slug>.ts)
 *   2) 이 파일의 ALL_PATTERNS 배열에 한 줄 추가
 *   3) (새 어휘 비율이면) default.md gridVocabulary 에 추가
 *   끝.
 */

import type { CompositionPattern } from "@/lib/layout/composition";

import { fullText } from "./full-text";
import { fullImage } from "./full-image";
import { halvesTextText } from "./halves-text-text";
import { halvesTextImage } from "./halves-text-image";
import { wideNarrowTextImage } from "./wide-narrow-text-image";
import { wideNarrowTableText } from "./wide-narrow-table-text";
import { thirdsTextTextText } from "./thirds-text-text-text";
import { thirdsImageImageImage } from "./thirds-image-image-image";
import { quartersTextTextTextText } from "./quarters-text-text-text-text";
import { quartersImageImageImageImage } from "./quarters-image-image-image-image";

// ─────────────────────────────────────────────────────────────
// 카탈로그
// ─────────────────────────────────────────────────────────────

/**
 * 1차 패턴 10개.
 *
 * 이 배열의 순서는 페이지네이션 LLM 의 카탈로그 표시 순서로 사용됨.
 * 가독성: 비율 단순 → 복잡 순 (full → halves → wide-narrow → thirds → quarters).
 */
export const ALL_PATTERNS: readonly CompositionPattern[] = [
  fullText,
  fullImage,
  halvesTextText,
  halvesTextImage,
  wideNarrowTextImage,
  wideNarrowTableText,
  thirdsTextTextText,
  thirdsImageImageImage,
  quartersTextTextTextText,
  quartersImageImageImageImage,
];

/**
 * slug 로 패턴 찾기. 검증·디버깅·grid.ts.realize() 호출 시 사용.
 */
export function findPatternBySlug(slug: string): CompositionPattern | undefined {
  return ALL_PATTERNS.find((p) => p.slug === slug);
}

// ─────────────────────────────────────────────────────────────
// 어휘 매칭 — 비율 정규화
// ─────────────────────────────────────────────────────────────

/**
 * 비율 배열을 정규화된 키 문자열로.
 *
 * 같은 비율을 다른 순서로 쓴 케이스를 같은 비율로 매칭하기 위함.
 *   [8, 4]      → "4-8"
 *   [4, 8]      → "4-8"   (같은 비율로 인식)
 *   [12]        → "12"
 *   [6, 6]      → "6-6"
 *   [4, 4, 4]   → "4-4-4"
 *   [3, 3, 3, 3] → "3-3-3-3"
 *
 * 정렬 기준: 오름차순. 단순한 비교가 가능.
 *
 * 콤포지션 정의에서 좌우 방향(어느 쪽이 넓은가)은 _variants.ts 의
 * asymmetryDirection 으로 처리하므로 비율 자체는 [8,4] 와 [4,8] 을 구분할
 * 필요 없음.
 */
function normalizeVocabularyRatio(ratio: readonly number[]): string {
  return [...ratio].sort((a, b) => a - b).join("-");
}

/**
 * CompositionPattern 의 슬롯에서 비율을 추론.
 *
 * 패턴 정의 자체에는 "비율" 필드가 없고 슬롯의 columnSpan 합으로 결정됨.
 * 단 풀블리드 슬롯은 columns 안 차지하므로 [12] 풀폭 의미로 처리.
 *
 * 예:
 *   full-text                       → slots[main].columnSpan=12       → [12]
 *   halves-*                        → 6 + 6                            → [6, 6]
 *   wide-narrow-*                   → 8 + 4                            → [8, 4]
 *   thirds-*                        → 4 + 4 + 4                        → [4, 4, 4]
 *   quarters-*                      → 3 + 3 + 3 + 3                    → [3, 3, 3, 3]
 *   full-image  (bleedToEdge)       → 슬롯이 columns 안 차지함        → [12] (풀폭)
 *
 * 풀블리드는 어휘상 풀폭과 같은 의미 (페이지 전체 사용) 이므로 [12] 비율로 매칭.
 * 정책상 자연스러움 — gridVocabulary 는 본문 영역의 분할 비율인데,
 * 풀블리드는 본문 영역을 분할 안 하고 전체를 씀.
 */
function inferPatternRatio(pattern: CompositionPattern): number[] {
  const hasBleed = pattern.slots.some((s) => s.bleedToEdge);
  if (hasBleed) return [12];

  // 슬롯들의 columnSpan 합으로 비율 추론. 1차 콤포지션은 모두 row 1 ~ -1 풀높이라 단순.
  const spans = pattern.slots
    .map((s) => s.area.columnSpan)
    .filter((s) => s !== -1); // -1 은 1차 콤포지션엔 없음 (방어적)

  return spans;
}

// ─────────────────────────────────────────────────────────────
// 검색 함수 (§16.5, §16.6)
// ─────────────────────────────────────────────────────────────

/**
 * 어휘 기반 1차 좁히기 (§16.6).
 *
 * 책 단위로 한 번 부름 — 페이지네이션 LLM 호출 직전.
 *
 * @param vocabulary  DesignTokens.gridVocabulary 그대로
 * @returns 어휘에 등장하는 비율과 매칭되는 콤포지션들
 *
 * 예:
 *   getPatternsForVocabulary([[12], [6,6], [8,4], [4,4,4], [3,3,3,3]])
 *     → ALL_PATTERNS 10개 모두 (1차 카탈로그가 정확히 default 어휘에 맞춰 박힘)
 *
 *   getPatternsForVocabulary([[12], [6,6]])
 *     → 4개 (full-text, full-image, halves-text-text, halves-text-image)
 *
 * 어휘에 매칭되는 패턴이 0개인 비율이 있으면 콘솔 경고.
 */
export function getPatternsForVocabulary(
  vocabulary: readonly (readonly number[])[],
): CompositionPattern[] {
  const allowedKeys = new Set(vocabulary.map(normalizeVocabularyRatio));

  const matched: CompositionPattern[] = [];
  for (const pattern of ALL_PATTERNS) {
    const ratio = inferPatternRatio(pattern);
    const key = normalizeVocabularyRatio(ratio);
    if (allowedKeys.has(key)) {
      matched.push(pattern);
    }
  }

  for (const ratio of vocabulary) {
    const key = normalizeVocabularyRatio(ratio);
    const hasMatch = matched.some(
      (p) => normalizeVocabularyRatio(inferPatternRatio(p)) === key,
    );
    if (!hasMatch) {
      console.warn(
        `[patterns] gridVocabulary 비율 [${ratio.join(",")}] 에 매칭되는 콤포지션 없음. 어휘 또는 카탈로그 점검 필요.`,
      );
    }
  }

  return matched;
}

/**
 * role 기반 2차 좁히기 (§16.6).
 *
 * 페이지 1장 만들 때 부름. LLM 이 페이지 의도(role)를 결정한 후 그 role 의
 * 콤포지션만 후보로 좁힘.
 *
 * @param role             페이지 의도
 * @param vocabularyPatterns getPatternsForVocabulary() 결과 또는 임의 패턴 리스트
 * @returns 매칭 패턴들
 *
 * 1차 카탈로그 10개의 role 분포:
 *   body    : full-text, halves-text-text, wide-narrow-text-image,
 *             thirds-text-text-text, quarters-text-text-text-text         (5개)
 *   media   : full-image, halves-text-image,
 *             thirds-image-image-image, quarters-image-image-image-image  (4개)
 *   data    : wide-narrow-table-text                                       (1개)
 *   cover / section-opener / closing: 1차 미박. body 또는 media 콤포지션 재사용.
 */
export function getPatternsByRole(
  role: CompositionPattern["role"],
  vocabularyPatterns: readonly CompositionPattern[] = ALL_PATTERNS,
): CompositionPattern[] {
  return vocabularyPatterns.filter((p) => p.role === role);
}

// ─────────────────────────────────────────────────────────────
// 검증 (§16.3 자동 검증)
// ─────────────────────────────────────────────────────────────

/**
 * 패턴 슬러그가 카탈로그에 실재하는지.
 * 페이지네이션 LLM 출력 검증 시 사용 (M3b-2/M3b-3).
 */
export function isPatternSlugValid(slug: string): boolean {
  return ALL_PATTERNS.some((p) => p.slug === slug);
}

/**
 * 패턴이 어휘 안에 있는지.
 * 페이지네이션 LLM 출력 검증 시 사용 — LLM 이 어휘 밖 패턴을 골랐는지 잡음.
 */
export function isPatternInVocabulary(
  slug: string,
  vocabulary: readonly (readonly number[])[],
): boolean {
  const pattern = findPatternBySlug(slug);
  if (!pattern) return false;
  const allowedKeys = new Set(vocabulary.map(normalizeVocabularyRatio));
  const key = normalizeVocabularyRatio(inferPatternRatio(pattern));
  return allowedKeys.has(key);
}

// ─────────────────────────────────────────────────────────────
// 개별 패턴 re-export (옵셔널 — 직접 import 도 가능)
// ─────────────────────────────────────────────────────────────

export {
  fullText,
  fullImage,
  halvesTextText,
  halvesTextImage,
  wideNarrowTextImage,
  wideNarrowTableText,
  thirdsTextTextText,
  thirdsImageImageImage,
  quartersTextTextTextText,
  quartersImageImageImageImage,
};
