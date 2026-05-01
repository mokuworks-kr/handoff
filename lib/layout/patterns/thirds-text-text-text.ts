/**
 * thirds-text-text-text — 3슬롯 균등 텍스트 콤포지션.
 *
 * 페이지를 균등 3분할 (default 어휘 [4,4,4]). 세 슬롯 모두 텍스트.
 *
 * 회사소개서 / IR 빈출:
 *   - 비전 + 미션 + 핵심가치 3개
 *   - 사업 영역 3개
 *   - 제품 라인업 3개 (텍스트 위주, 이미지가 작은 경우)
 *   - 핵심 지표 3개 (예: 매출/영업이익/고객사)
 *
 * §11 약속 2번 적용: 같은 콤포지션이라도 들어가는 콘텐츠로 다양화.
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정
 * ─────────────────────────────────────────────────────────────
 *
 * - **slots 3개 (left, center, right)**: 각 4칸. 12단 그리드 기준 4+4+4.
 *   슬롯 사이 거터는 grid.ts 가 format.gutter 로 자동 처리.
 * - **variants 없음**: 균등 비율이라 슬롯 위치 결정 의미 없음 (어차피 셋 다 같은 종류).
 * - **paragraphStyleId 모두 "body"**: 1차 default.
 * - **totalRows = 12**: 통일.
 */

import type { CompositionPattern } from "@/lib/layout/composition";

export const thirdsTextTextText: CompositionPattern = {
  slug: "thirds-text-text-text",
  name: "3단 텍스트",
  description:
    "페이지를 균등 3분할. 세 슬롯 모두 텍스트. 비전/미션/가치, 사업 영역 3개, 핵심 지표 3개 등에 사용.",
  role: "body",
  totalRows: 12,
  slots: [
    {
      id: "left",
      kind: "text",
      label: "왼쪽",
      paragraphStyleId: "body",
      area: { column: 1, columnSpan: 4, row: 1, rowSpan: -1 },
    },
    {
      id: "center",
      kind: "text",
      label: "가운데",
      paragraphStyleId: "body",
      area: { column: 5, columnSpan: 4, row: 1, rowSpan: -1 },
    },
    {
      id: "right",
      kind: "text",
      label: "오른쪽",
      paragraphStyleId: "body",
      area: { column: 9, columnSpan: 4, row: 1, rowSpan: -1 },
    },
  ],
};
