/**
 * 비대칭 콤포지션 공통 variants.
 *
 * ─────────────────────────────────────────────────────────────
 * 무엇 / 왜
 * ─────────────────────────────────────────────────────────────
 *
 * 비대칭 비율(예: [8,4], 미래에 [9,3], [7,5], [8,2,2] 등)을 갖는 콤포지션은
 * 한 가지 공통 결정을 매번 내려야 한다: **넓은 칸이 페이지의 어느 쪽인가?**
 *
 * 잘 만든 책은 이 결정을 콘텐츠 맥락에 맞게 내린다:
 *   - 반복 카탈로그 (제품 라인업 등): 책 전체에서 넓은 칸 위치를 고정 → 통일감
 *   - 잡지 본문: 펼침면 균형을 위해 좌우 페이지 거울 미러링
 *
 * 1차에서는 인프라 한계로 **물리적 좌우(wide-left / wide-right) 2가지만** 박는다.
 * 펼침면 미러링(EdgeAffinity 기반)은 미래 작업으로 미룸 — 이유는 아래 "박힌 한계" 참조.
 *
 * §11 약속 1번 ("그리드 어휘는 책 단위 고정") 안 깸: 비율 [8,4]는 그대로,
 * variants는 어휘 안의 좌우 미세 조정일 뿐.
 * §11 약속 3번 ("리듬 규칙 박제 0개") 부합: 좌우 결정이 코드 룰이 아니라
 * LLM이 콘텐츠와 rhythmGuide 보고 내림.
 *
 * ─────────────────────────────────────────────────────────────
 * 사용
 * ─────────────────────────────────────────────────────────────
 *
 * 비대칭 콤포지션 파일이 import 해서 자기 슬롯들에 맞는 override 채워 넣음:
 *
 *   // grid-8-4.ts
 *   import { buildAsymmetryVariants } from "./_variants";
 *
 *   const variants = buildAsymmetryVariants({
 *     wideSlotId: "wide",
 *     narrowSlotId: "narrow",
 *     // wide-left 시 (default): wide=col 1 span 8, narrow=col 9 span 4
 *     // wide-right 시:           wide=col 5 span 8, narrow=col 1 span 4
 *     wideLeft:  { wide: { column: 1, columnSpan: 8 }, narrow: { column: 9, columnSpan: 4 } },
 *     wideRight: { wide: { column: 5, columnSpan: 8 }, narrow: { column: 1, columnSpan: 4 } },
 *   });
 *
 * 미래에 새 비대칭 비율(예: grid-7-5)이 어휘에 추가되면 같은 함수를 import 해서 쓰면 됨.
 * 코드 중복 0, 정책 일관성 보장.
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 한계 — wide-outside / wide-inside 미지원 (1차)
 * ─────────────────────────────────────────────────────────────
 *
 * "넓은 칸이 펼침면 바깥쪽" 같은 EdgeAffinity 기반 옵션은 박지 않았다.
 *
 * 이유: composition.ts의 VariantOption.override 타입이 Partial<GridArea> —
 * 즉 column / columnSpan / row / rowSpan만 override 가능. ContentSlot.edge 필드는
 * override 메커니즘이 받지 않음. 1차에서 인프라 확장 없이 갈 수 있는 안전한 범위가
 * 물리적 좌우 2개.
 *
 * 미래에 펼침면 미러링이 필요해지면 두 갈래:
 *   a) VariantOption.override 타입에 edge 필드 추가 (composition.ts 확장)
 *   b) 슬롯 정의 자체에 edge 박고, EdgeAffinity 처리는 grid.ts.realize() 가
 *      side(left/right)와 함께 자동 미러링 (이미 박혀있는 메커니즘)
 *
 * 1차 default.md는 차분한 호흡(rhythmGuide)이라 펼침 미러링이 강하게 필요하지 않음.
 */

import type { GridArea, Variant } from "@/lib/layout/composition";

/**
 * 비대칭 콤포지션의 좌우 방향 variant ID.
 *
 * 모든 비대칭 콤포지션이 이 ID로 variants 에 들어감. LLM이 페이지/섹션 단위로
 * 일관된 옵션을 선택하도록 (반복 카탈로그면 wide-left 일관 유지) rhythmGuide 가
 * 유도.
 */
export const ASYMMETRY_VARIANT_ID = "asymmetryDirection" as const;

/**
 * 좌우 방향 옵션 값.
 *
 * - wide-left  : 넓은 칸이 페이지의 물리적 왼쪽 (default — 한국어 가로쓰기 시선 흐름)
 * - wide-right : 넓은 칸이 페이지의 물리적 오른쪽
 *
 * 1차에는 둘만. 미래 wide-outside / wide-inside 추가 가능 (위 "박힌 한계" 참조).
 */
export const ASYMMETRY_OPTION_VALUES = ["wide-left", "wide-right"] as const;
export type AsymmetryOptionValue = (typeof ASYMMETRY_OPTION_VALUES)[number];

/**
 * 비대칭 콤포지션이 부르는 헬퍼.
 *
 * 슬롯별 GridArea 부분 override 를 받아 Variant 객체 1개를 반환.
 *
 * @param config.wideSlotId    넓은 칸 슬롯의 id (예: "wide")
 * @param config.narrowSlotId  좁은 칸 슬롯의 id (예: "narrow")
 * @param config.wideLeft      wide-left 옵션 적용 시 슬롯별 GridArea 부분 (default 값)
 * @param config.wideRight     wide-right 옵션 적용 시 슬롯별 GridArea 부분
 *
 * 콤포지션 파일은 자기 슬롯의 base area 와 다른 부분만 override 에 넣어도 되고,
 * 명시적으로 전체를 넣어도 된다. composition.ts 의 applyOverride() 가 명시한 필드만
 * 덮어쓰므로 둘 다 동작.
 */
export function buildAsymmetryVariants(config: {
  wideSlotId: string;
  narrowSlotId: string;
  wideLeft: Record<string, Partial<GridArea>>;
  wideRight: Record<string, Partial<GridArea>>;
}): Variant {
  // override 키가 wide/narrow 슬롯 id 와 일치하는지 가벼운 검증.
  // 콤포지션 정의 시점에 잡으면 LLM 호출 단계에서 발견되는 것보다 훨씬 쌈.
  const expectedKeys = new Set([config.wideSlotId, config.narrowSlotId]);
  for (const [key] of Object.entries(config.wideLeft)) {
    if (!expectedKeys.has(key)) {
      throw new Error(
        `_variants.buildAsymmetryVariants: wideLeft override key "${key}" must be wideSlotId or narrowSlotId`,
      );
    }
  }
  for (const [key] of Object.entries(config.wideRight)) {
    if (!expectedKeys.has(key)) {
      throw new Error(
        `_variants.buildAsymmetryVariants: wideRight override key "${key}" must be wideSlotId or narrowSlotId`,
      );
    }
  }

  return {
    id: ASYMMETRY_VARIANT_ID,
    label: "넓은 칸 위치",
    defaultValue: "wide-left",
    options: [
      {
        value: "wide-left",
        label: "넓은 칸이 왼쪽",
        override: config.wideLeft,
      },
      {
        value: "wide-right",
        label: "넓은 칸이 오른쪽",
        override: config.wideRight,
      },
    ],
  };
}
