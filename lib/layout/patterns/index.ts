/**
 * 콤포지션 패턴 카탈로그 — 1차.
 *
 * ─────────────────────────────────────────────────────────────
 * 카탈로그 구성 (M3b-1)
 * ─────────────────────────────────────────────────────────────
 *
 * default.md 어휘 [[12], [6,6], [8,4]] 안의 콤포지션 6개:
 *
 *   비율 [12]  — grid-12-text       (텍스트 풀폭)
 *              grid-12-image       (이미지 풀블리드)
 *   비율 [6,6] — grid-6-6-text-text  (텍스트 두 단)
 *              grid-6-6-text-image  (텍스트 + 이미지 균등)
 *   비율 [8,4] — grid-8-4-text-image (넓은 텍스트 + 좁은 이미지) ★ variants
 *              grid-8-4-table-text  (넓은 표 + 좁은 캡션)        ★ variants
 *
 * §11 약속 1번 (어휘는 책 단위 고정) 부합:
 *   각 콤포지션은 어휘의 한 비율에 매칭. 같은 비율의 여러 콤포지션은 슬롯 종류 차이로
 *   다양화 (§11 약속 2번 — "다양성은 슬롯 안 콘텐츠로").
 *
 * §16.5 동적 주입 정책 부합:
 *   페이지네이션 LLM (M3b-2) 호출 시 이 카탈로그가 user message 로 주입됨.
 *   디자인이 늘어도 (§16.8 시나리오) 프롬프트는 1개 그대로.
 *
 * §16.6 후보 좁히기 부합:
 *   getPatternsForVocabulary() 가 어휘로 1차 좁힘.
 *   getPatternsByRole() 가 role 로 2차 좁힘.
 *
 * ─────────────────────────────────────────────────────────────
 * 미래 확장
 * ─────────────────────────────────────────────────────────────
 *
 * 1차 시드 5개 검증 후 부족한 조합이 발견되면 추가:
 *   - 풀폭 표 (grid-12-table) — 큰 표가 페이지를 가득 채우는 IR 케이스
 *   - 텍스트 + 차트 (grid-6-6-text-chart, grid-8-4-text-chart)
 *   - 이미지 + 표 (grid-6-6-image-table)
 *   - 새 비율 (grid-9-3, grid-7-5 등) — 디자이너 스타일 확장 시
 *
 * 추가 시 코드 변경:
 *   1) 새 패턴 파일 추가 (lib/layout/patterns/<slug>.ts)
 *   2) 이 파일의 ALL_PATTERNS 배열에 한 줄 추가
 *   끝.
 */

import type { CompositionPattern } from "@/lib/layout/composition";

import { grid12Text } from "./grid-12-text";
import { grid12Image } from "./grid-12-image";
import { grid66TextText } from "./grid-6-6-text-text";
import { grid66TextImage } from "./grid-6-6-text-image";
import { grid84TextImage } from "./grid-8-4-text-image";
import { grid84TableText } from "./grid-8-4-table-text";

// ─────────────────────────────────────────────────────────────
// 카탈로그
// ─────────────────────────────────────────────────────────────

/**
 * 1차 패턴 6개 — 어휘 [[12], [6,6], [8,4]] 안에서 슬롯 종류 조합으로 다양화.
 *
 * 이 배열의 순서는 페이지네이션 LLM 의 카탈로그 표시 순서로 사용됨.
 * 가독성: 비율 → 슬롯 종류 순.
 */
export const ALL_PATTERNS: readonly CompositionPattern[] = [
  grid12Text,
  grid12Image,
  grid66TextText,
  grid66TextImage,
  grid84TextImage,
  grid84TableText,
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
 *   [8, 4]  → "4-8"
 *   [4, 8]  → "4-8"   (같은 비율로 인식)
 *   [12]    → "12"
 *   [6, 6]  → "6-6"
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
 * 단 풀블리드 슬롯은 columns 안 차지하므로 제외.
 *
 * 예:
 *   grid-12-text   → slots[main].columnSpan=12       → [12]
 *   grid-6-6-*     → 6 + 6                            → [6, 6]
 *   grid-8-4-*     → 8 + 4                            → [8, 4]
 *   grid-12-image  → bleedToEdge → 슬롯이 columns 안 차지함 → [12] 로 간주 (풀폭 의미)
 *
 * 풀블리드는 어휘상 풀폭과 같은 의미 (페이지 전체 사용) 이므로 [12] 비율로 매칭.
 * 이게 정책상 자연스러움 — gridVocabulary 는 본문 영역의 분할 비율인데,
 * 풀블리드는 본문 영역을 분할 안 하고 전체를 씀.
 */
function inferPatternRatio(pattern: CompositionPattern): number[] {
  // 풀블리드 슬롯이 하나라도 있으면 그것이 페이지 전체를 차지 → [12] 로 간주
  const hasBleed = pattern.slots.some((s) => s.bleedToEdge);
  if (hasBleed) return [12];

  // 그 외에는 슬롯들의 columnSpan 합으로 비율 추론.
  // 같은 row 의 슬롯들만 합쳐야 정확한데, 1차 콤포지션은 모두 row 1 ~ -1 풀높이라
  // 단순 합으로 충분. 미래에 row 변형이 박히면 row 그룹별로 합산하도록 확장.
  const spans = pattern.slots
    .map((s) => s.area.columnSpan)
    .filter((s) => s !== -1); // -1 은 "남은 칸 전부" — 1차 콤포지션엔 없음

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
 *   getPatternsForVocabulary([[12], [6,6], [8,4]])
 *     → ALL_PATTERNS 6개 모두 (1차 카탈로그가 정확히 이 어휘에 맞춰 박힘)
 *
 *   getPatternsForVocabulary([[12], [4,4,4]])
 *     → [grid-12-text, grid-12-image] 만 (4-4-4 매칭 패턴 없음)
 *     → 미래 디자인이 [4,4,4] 어휘를 쓰려면 grid-4-4-4-* 콤포지션 추가 필요
 *
 * 어휘에 매칭되는 패턴이 0개인 비율이 있으면 콘솔 경고.
 * 페이지네이션이 그 비율을 못 쓰는 상황이라 디자인 정의 점검 필요.
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

  // 디버깅 보조 — 어휘에 매칭되는 콤포지션 0개인 비율 찾기
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
 * 페이지 1장 만들 때 부름. LLM 이 페이지 의도(role)를 결정한 후
 * 그 role 의 콤포지션만 후보로 좁힘.
 *
 * @param role             페이지 의도
 * @param vocabularyPatterns getPatternsForVocabulary() 결과 또는 임의 패턴 리스트
 * @returns 매칭 패턴들
 *
 * 1차 카탈로그 6개의 role 분포:
 *   body    : grid-12-text, grid-6-6-text-text, grid-8-4-text-image
 *   media   : grid-12-image, grid-6-6-text-image
 *   data    : grid-8-4-table-text
 *   cover / section-opener / closing: 1차 미박. body 또는 media 콤포지션을 재사용.
 *
 * cover/section-opener/closing 이 미박인 이유: 같은 grid-12-text 가 표지·장 시작·
 * 마무리에도 충분 (콘텐츠 다양성으로 차별화). 미래에 표지 전용 변형이 필요해지면
 * 그때 추가.
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
 * 페이지네이션 LLM 출력 검증 시 사용 (M3b-2/M3b-3 에서).
 */
export function isPatternSlugValid(slug: string): boolean {
  return ALL_PATTERNS.some((p) => p.slug === slug);
}

/**
 * 패턴이 어휘 안에 있는지.
 * 페이지네이션 LLM 출력 검증 시 사용 — LLM 이 어휘 밖 패턴을 골랐는지 잡음.
 *
 * @param slug        검사할 패턴 slug
 * @param vocabulary  DesignTokens.gridVocabulary
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
  grid12Text,
  grid12Image,
  grid66TextText,
  grid66TextImage,
  grid84TextImage,
  grid84TableText,
};
