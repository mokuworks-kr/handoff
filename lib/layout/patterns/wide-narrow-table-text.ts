/**
 * wide-narrow-table-text — 넓은 표 + 좁은 캡션 콤포지션.
 *
 * 페이지를 비대칭 2분할 (default 어휘 [8,4]). 넓은 칸 표, 좁은 칸 캡션 텍스트.
 *
 * IR 의 가장 흔한 페이지 종류 중 하나:
 *   - 재무제표 (4년치 손익) + 옆에 핵심 해설 캡션
 *   - KPI 표 + 해설
 *   - 임원 명단 표 + 약력 캡션
 *
 * data-like 섹션의 자연스러운 시각 표현. 표만 풀폭으로 두는 것보다
 * 사이드 캡션이 있으면 독자가 표를 읽는 시점에 맥락을 같이 잡을 수 있음.
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정
 * ─────────────────────────────────────────────────────────────
 *
 * - **slots 2개 (wide, narrow)**: wide=TableSlot 8칸, narrow=TextSlot 4칸 (caption).
 * - **variants — asymmetryDirection**: wide-narrow-text-image 와 동일.
 *   - default "wide-left" — 표가 왼쪽, 캡션이 오른쪽. 한국어 시선 흐름.
 *   - LLM 이 책 호흡에 따라 wide-right 선택 가능.
 * - **paragraphStyleId = "caption"**: default.md 의 caption 스타일 사용
 *   (작은 글씨 + textMuted 색).
 * - **표 크기 hint 없음**: §1 약속 (원고 안 다듬음) 따라 표 행/열 강제 안 함.
 * - **totalRows = 12**: 통일.
 */

import type { CompositionPattern } from "@/lib/layout/composition";
import { buildAsymmetryVariants } from "./_variants";

export const wideNarrowTableText: CompositionPattern = {
  slug: "wide-narrow-table-text",
  name: "넓은 표 + 좁은 캡션",
  description:
    "페이지를 비대칭 2분할 (8:4). 넓은 칸 표, 좁은 칸 캡션. 재무제표+해설, KPI 표+캡션, 임원 명단+약력 등 data-like 섹션에 사용.",
  role: "data",
  totalRows: 12,
  slots: [
    {
      id: "wide",
      kind: "table",
      label: "넓은 칸 (표)",
      area: { column: 1, columnSpan: 8, row: 1, rowSpan: -1 },
    },
    {
      id: "narrow",
      kind: "text",
      label: "좁은 칸 (캡션)",
      paragraphStyleId: "caption",
      area: { column: 9, columnSpan: 4, row: 1, rowSpan: -1 },
    },
  ],
  variants: [
    buildAsymmetryVariants({
      wideSlotId: "wide",
      narrowSlotId: "narrow",
      wideLeft: {
        wide: { column: 1, columnSpan: 8 },
        narrow: { column: 9, columnSpan: 4 },
      },
      wideRight: {
        wide: { column: 5, columnSpan: 8 },
        narrow: { column: 1, columnSpan: 4 },
      },
    }),
  ],
};
