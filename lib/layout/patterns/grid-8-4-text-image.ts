/**
 * grid-8-4-text-image — 넓은 텍스트 + 좁은 이미지 콤포지션.
 *
 * ─────────────────────────────────────────────────────────────
 * 무엇 / 왜
 * ─────────────────────────────────────────────────────────────
 *
 * 페이지를 8칸 + 4칸 비대칭으로 분할. 넓은 칸(8) 텍스트, 좁은 칸(4) 이미지.
 *
 * 사용자가 든 예시 케이스 — "제품명 + 제품 이미지 + 소개 줄글이 반복되는 카탈로그":
 *   - 넓은 칸: 제품명 (heading) + 소개 줄글 (body)
 *   - 좁은 칸: 제품 이미지
 *
 * 그 외 사용처:
 *   - 본문 + 사이드 인포그래픽 / 아이콘
 *   - 본문 + 인물 사진 (사진이 작아도 충분한 경우)
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정
 * ─────────────────────────────────────────────────────────────
 *
 * - **slots 2개 (wide, narrow)**: wide=TextSlot 8칸, narrow=ImageSlot 4칸.
 * - **variants — asymmetryDirection** (★): 1차의 핵심 결정.
 *   - 비대칭 비율이라 좌우 결정 필요.
 *   - _variants.ts 의 buildAsymmetryVariants() 헬퍼 사용 → 미래 다른 비대칭 비율
 *     (grid-9-3, grid-7-5 등) 추가 시 같은 메커니즘 재사용. 코드 중복 0.
 *   - default = "wide-left" — 한국어 가로쓰기 시선 흐름. 사용자 카탈로그 케이스
 *     ("페이지 왼쪽 8칸 텍스트, 오른쪽 4칸 이미지") 와 자연스럽게 일치.
 *   - LLM 이 페이지/섹션 단위로 일관 선택 (반복 카탈로그면 wide-left 고정 유지).
 *     §11 약속 3번 ("리듬 규칙 박제 0개") 부합 — 코드가 강제 안 함.
 *
 * - **base area = wide-left 의 좌표**: variants 미적용 시 default 동작.
 *   wide=col 1 span 8, narrow=col 9 span 4. wide-right 옵션 시 override 로 뒤집힘.
 *
 * - **totalRows = 12**: 통일.
 *
 * ─────────────────────────────────────────────────────────────
 * variants override 설명 (디버깅용)
 * ─────────────────────────────────────────────────────────────
 *
 * wide-left  (default): wide=col 1 span 8, narrow=col 9 span 4
 * wide-right          : wide=col 5 span 8, narrow=col 1 span 4
 *
 * 즉 8칸 시작 위치와 4칸 시작 위치가 좌우 반전. columnSpan 자체는 그대로.
 * 검증: 8+4 = 12 (book 어휘 [8,4]) — §11 약속 1번 안 깸.
 */

import type { CompositionPattern } from "@/lib/layout/composition";
import { buildAsymmetryVariants } from "./_variants";

export const grid84TextImage: CompositionPattern = {
  slug: "grid-8-4-text-image",
  name: "넓은 텍스트 + 좁은 이미지",
  description:
    "페이지를 8칸(텍스트) + 4칸(이미지) 비대칭 분할. 제품 카탈로그(제품명+소개글 / 제품 이미지), 본문+사이드 등에 사용.",
  role: "body",
  totalRows: 12,
  slots: [
    {
      id: "wide",
      kind: "text",
      label: "넓은 칸 (텍스트)",
      paragraphStyleId: "body",
      area: { column: 1, columnSpan: 8, row: 1, rowSpan: -1 },
    },
    {
      id: "narrow",
      kind: "image",
      label: "좁은 칸 (이미지)",
      area: { column: 9, columnSpan: 4, row: 1, rowSpan: -1 },
      fit: "cover",
    },
  ],
  variants: [
    buildAsymmetryVariants({
      wideSlotId: "wide",
      narrowSlotId: "narrow",
      // wide-left (default 와 일치): 명시 안 해도 base area 가 답이지만 명시성 위해 적음
      wideLeft: {
        wide: { column: 1, columnSpan: 8 },
        narrow: { column: 9, columnSpan: 4 },
      },
      // wide-right: 좌우 반전
      wideRight: {
        wide: { column: 5, columnSpan: 8 },
        narrow: { column: 1, columnSpan: 4 },
      },
    }),
  ],
};
