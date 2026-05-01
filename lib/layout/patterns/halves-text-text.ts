/**
 * halves-text-text — 본문 두 단 콤포지션.
 *
 * 페이지 본문 영역을 균등 2분할. 양쪽 모두 텍스트.
 *
 * 사용처:
 *   - 좌우 비교 (현재 vs 미래, before vs after, A 안 vs B 안)
 *   - 비전+미션, 회사 소개+사업 영역 등 두 가지 동등한 정보
 *   - 인용 + 본문, 본문 + 사이드 노트
 *
 * §11 약속 2번 적용: 같은 halves-text-text 라도 left 에 회사 비전, right 에 미션이
 * 들어가거나, left 에 인용구, right 에 해설이 들어가는 등 콘텐츠 다양성으로 차별화.
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정
 * ─────────────────────────────────────────────────────────────
 *
 * - **slots 2개 (left, right)**: 각 6칸. 둘 다 TextSlot. 12단 그리드 기준 6+6.
 * - **variants 없음**: 대칭 비율이라 좌우 결정 의미 없음.
 * - **두 슬롯 사이 gutter**: format.gutter 가 자동 처리.
 * - **paragraphStyleId 둘 다 "body"**: 1차 default.
 * - **totalRows = 12**: 통일.
 */

import type { CompositionPattern } from "@/lib/layout/composition";

export const halvesTextText: CompositionPattern = {
  slug: "halves-text-text",
  name: "두 단 텍스트",
  description:
    "페이지를 균등 2분할. 양쪽 모두 텍스트. 좌우 비교, 본문 두 단, 인용+해설 등에 사용.",
  role: "body",
  totalRows: 12,
  slots: [
    {
      id: "left",
      kind: "text",
      label: "왼쪽 본문",
      paragraphStyleId: "body",
      area: { column: 1, columnSpan: 6, row: 1, rowSpan: -1 },
    },
    {
      id: "right",
      kind: "text",
      label: "오른쪽 본문",
      paragraphStyleId: "body",
      area: { column: 7, columnSpan: 6, row: 1, rowSpan: -1 },
    },
  ],
};
