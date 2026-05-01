/**
 * grid-6-6-text-text — 본문 두 단 콤포지션.
 *
 * ─────────────────────────────────────────────────────────────
 * 무엇 / 왜
 * ─────────────────────────────────────────────────────────────
 *
 * 페이지 본문 영역을 6칸 + 6칸으로 균등 분할. 양쪽 모두 텍스트.
 *
 * 사용처:
 *   - 좌우 비교 (현재 vs 미래, before vs after, A 안 vs B 안)
 *   - 두 단 본문 (잡지/논문 스타일의 긴 본문 — 하지만 한 슬롯 안의 columns 옵션으로
 *     처리하는 게 더 자연스러울 수도. 1차에서는 두 슬롯으로 표현)
 *   - 인용 + 본문, 본문 + 사이드 노트
 *
 * §11 약속 2번 적용: 같은 grid-6-6-text-text 라도 left 에 회사 비전, right 에 미션이
 * 들어가거나, left 에 인용구, right 에 해설이 들어가는 등 콘텐츠 다양성으로 차별화.
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정
 * ─────────────────────────────────────────────────────────────
 *
 * - **slots 2개 (left, right)**: 각 6칸. 둘 다 TextSlot.
 * - **variants 없음**: 대칭 비율이라 좌우 결정 의미 없음 ([6,6] = [6,6]).
 * - **두 슬롯 사이 gutter**: format.gutter 가 자동 처리 (grid.ts.realize 계산).
 * - **paragraphStyleId 둘 다 "body"**: 1차 default. LLM 이 페이지마다
 *   PageBlueprint.content 의 headingLevel 로 헤딩 강조 가능.
 * - **totalRows = 12**: 모든 1차 콤포지션 통일.
 */

import type { CompositionPattern } from "@/lib/layout/composition";

export const grid66TextText: CompositionPattern = {
  slug: "grid-6-6-text-text",
  name: "두 단 텍스트",
  description:
    "페이지를 6칸 + 6칸으로 균등 분할. 양쪽 모두 텍스트. 좌우 비교, 본문 두 단, 인용+해설 등에 사용.",
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
