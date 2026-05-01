/**
 * quarters-text-text-text-text — 4슬롯 균등 텍스트 콤포지션.
 *
 * 페이지를 균등 4분할 (default 어휘 [3,3,3,3]). 네 슬롯 모두 텍스트.
 *
 * 회사소개서 / IR 빈출:
 *   - 분기별 실적 4개 (1Q/2Q/3Q/4Q 텍스트)
 *   - 임원 4명 약력 (사진 없이 텍스트만)
 *   - 4단계 프로세스 (기획/개발/검증/출시)
 *   - 4개 사업 단위
 *
 * §11 약속 2번 적용: 같은 콤포지션이지만 분기별 실적 / 4단계 프로세스 / 4명 약력 등
 * 다양한 의미로 사용.
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정
 * ─────────────────────────────────────────────────────────────
 *
 * - **slots 4개 (q1, q2, q3, q4)**: 각 3칸. 12단 그리드 기준 3+3+3+3.
 *   슬롯 id 는 q1~q4 (quarter 의 약어). 분기별 실적 의미와도 자연스러움.
 * - **variants 없음**: 균등.
 * - **paragraphStyleId 모두 "body"**: 1차 default.
 * - **totalRows = 12**: 통일.
 *
 * - **사진+이름 혼합 카드 1차 미지원**: 임원 4명 명단 같은 "사진+이름+직책" 카드는
 *   슬롯 시스템 한계로 1차에 표현 어려움. 텍스트만 또는 사진만 (quarters-image-image-image-image).
 *   미래에 카드형 슬롯 또는 slot composition (슬롯 안에 슬롯) 인프라 추가 시 풀림.
 */

import type { CompositionPattern } from "@/lib/layout/composition";

export const quartersTextTextTextText: CompositionPattern = {
  slug: "quarters-text-text-text-text",
  name: "4단 텍스트",
  description:
    "페이지를 균등 4분할. 네 슬롯 모두 텍스트. 분기별 실적, 4명 약력 (텍스트), 4단계 프로세스, 4개 사업 단위 등에 사용.",
  role: "body",
  totalRows: 12,
  slots: [
    {
      id: "q1",
      kind: "text",
      label: "1번",
      paragraphStyleId: "body",
      area: { column: 1, columnSpan: 3, row: 1, rowSpan: -1 },
    },
    {
      id: "q2",
      kind: "text",
      label: "2번",
      paragraphStyleId: "body",
      area: { column: 4, columnSpan: 3, row: 1, rowSpan: -1 },
    },
    {
      id: "q3",
      kind: "text",
      label: "3번",
      paragraphStyleId: "body",
      area: { column: 7, columnSpan: 3, row: 1, rowSpan: -1 },
    },
    {
      id: "q4",
      kind: "text",
      label: "4번",
      paragraphStyleId: "body",
      area: { column: 10, columnSpan: 3, row: 1, rowSpan: -1 },
    },
  ],
};
